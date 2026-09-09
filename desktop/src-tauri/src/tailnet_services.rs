use serde_json::Value;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;

pub struct Candidate {
    pub url: String,
    pub hostname: String,
    pub address: SocketAddr,
}
/// Do not accept an arbitrary host from the webview: revalidate the selected peer.
pub fn candidates(status: &Value, address: &str) -> Result<Vec<Candidate>, String> {
    let ip: Ipv4Addr = address
        .parse()
        .map_err(|_| "Choose a device from your Tailscale list")?;
    let octets = ip.octets();
    if octets[0] != 100 || !(64..=127).contains(&octets[1]) {
        return Err("Choose a private Tailscale device".into());
    }
    let peer = status["Peer"]
        .as_object()
        .into_iter()
        .flat_map(|v| v.values())
        .find(|p| {
            p["TailscaleIPs"]
                .as_array()
                .map(|ips| ips.iter().any(|a| a.as_str() == Some(address)))
                .unwrap_or(false)
        })
        .ok_or("This device is no longer on your Tailscale network")?;
    if peer["Online"].as_bool() != Some(true) {
        return Err("This device is offline. Turn it on and reconnect Tailscale".into());
    }
    let mut result = Vec::new();
    let dns = peer["DNSName"]
        .as_str()
        .unwrap_or("")
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if dns.ends_with(".ts.net")
        && dns.len() <= 253
        && dns.split('.').all(|part| {
            !part.is_empty()
                && part.len() <= 63
                && !part.starts_with('-')
                && !part.ends_with('-')
                && part.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
    {
        for port in [443, 8450] {
            result.push(Candidate {
                url: if port == 443 {
                    format!("https://{dns}")
                } else {
                    format!("https://{dns}:{port}")
                },
                hostname: dns.clone(),
                address: SocketAddr::new(IpAddr::V4(ip), port),
            });
        }
    }
    for port in [7864, 7863] {
        result.push(Candidate {
            url: format!("http://{ip}:{port}"),
            hostname: ip.to_string(),
            address: SocketAddr::new(IpAddr::V4(ip), port),
        });
    }
    Ok(result)
}
fn studio_manifest(value: &Value) -> bool {
    value["vibexStudio"]["version"].as_u64() == Some(1)
}
pub async fn probe(targets: Vec<Candidate>) -> Result<Vec<String>, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let mut found = Vec::new();
    for target in targets {
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_millis(800))
            .timeout(Duration::from_secs(2))
            .resolve(&target.hostname, target.address)
            .build()
            .map_err(|_| "Could not start the connection check")?;
        let Ok(mut response) = client
            .get(format!("{}/manifest.json", target.url))
            .send()
            .await
        else {
            continue;
        };
        if !response.status().is_success() || response.content_length().is_some_and(|n| n > 65536) {
            continue;
        }
        let mut bytes = Vec::new();
        let mut complete = true;
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    if bytes.len() + chunk.len() > 65536 {
                        complete = false;
                        break;
                    }
                    bytes.extend_from_slice(&chunk);
                }
                Ok(None) => break,
                Err(_) => {
                    complete = false;
                    break;
                }
            }
        }
        if complete
            && serde_json::from_slice::<Value>(&bytes)
                .ok()
                .is_some_and(|v| studio_manifest(&v))
        {
            found.push(target.url);
        }
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn status() -> Value {
        json!({"Peer":{"peer":{"TailscaleIPs":["YOUR_TAILNET_IP"],"Online":true,"DNSName":"spark.example.ts.net."}}})
    }
    #[test]
    fn selected_peer_candidates_are_bounded_and_https_first() {
        let values = candidates(&status(), "YOUR_TAILNET_IP").unwrap();
        assert_eq!(
            values.iter().map(|x| x.url.as_str()).collect::<Vec<_>>(),
            vec![
                "https://spark.example.ts.net",
                "https://spark.example.ts.net:8450",
                "http://YOUR_TAILNET_IP:7864",
                "http://YOUR_TAILNET_IP:7863"
            ]
        );
        assert!(values
            .iter()
            .all(|x| x.address.ip().to_string() == "YOUR_TAILNET_IP"));
    }
    #[test]
    fn rejects_unknown_public_offline_or_malformed_targets() {
        for address in [
            "127.0.0.1",
            "100.200.0.1",
            "100.66.238.98",
            "YOUR_TAILNET_IP:80",
        ] {
            assert!(candidates(&status(), address).is_err());
        }
        let mut value = status();
        value["Peer"]["peer"]["Online"] = json!(false);
        assert!(candidates(&value, "YOUR_TAILNET_IP").is_err());
        let mut value = status();
        value["Peer"]["peer"]["DNSName"] = json!("evil.example/path.ts.net");
        assert_eq!(candidates(&value, "YOUR_TAILNET_IP").unwrap().len(), 2);
    }
    #[test]
    fn ordinary_http_success_is_not_media_lab() {
        assert!(!studio_manifest(&json!({"name":"Any website"})));
        assert!(!studio_manifest(&json!({"vibexStudio":{"version":2}})));
        assert!(studio_manifest(&json!({"vibexStudio":{"version":1}})));
    }
    #[test]
    fn actual_http_probe_requires_manifest_and_rejects_redirects_or_oversized_bodies() {
        use std::io::{Read, Write};
        for (status, body, accepted) in [
            (
                "200 OK",
                r#"{"vibexStudio":{"version":1}}"#.to_string(),
                true,
            ),
            ("200 OK", "not Media Lab".to_string(), false),
            (
                "302 Found",
                r#"{"vibexStudio":{"version":1}}"#.to_string(),
                false,
            ),
            ("200 OK", "x".repeat(65537), false),
        ] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let thread = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut request = [0; 4096];
                let n = stream.read(&mut request).unwrap();
                let text = String::from_utf8_lossy(&request[..n]);
                assert!(text.starts_with("GET /manifest.json "));
                assert!(!text.to_lowercase().contains("authorization:"));
                let reply=format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nLocation: http://127.0.0.1:1/other\r\nConnection: close\r\n\r\n{body}",body.len());
                let _ = stream.write_all(reply.as_bytes());
            });
            let url = format!("http://{address}");
            let found = tauri::async_runtime::block_on(probe(vec![Candidate {
                url: url.clone(),
                hostname: "127.0.0.1".into(),
                address,
            }]))
            .unwrap();
            assert_eq!(found, if accepted { vec![url] } else { vec![] });
            thread.join().unwrap();
        }
    }
    #[test]
    #[ignore = "explicit selected-peer runtime qualification only"]
    fn live_selected_peer() {
        let address = std::env::var("VIBEX_REVIEW_TAILNET_PEER").expect("explicit peer required");
        let expected =
            std::env::var("VIBEX_REVIEW_EXPECTED_URL").expect("expected verified service required");
        let status = crate::read_tailscale_status().unwrap();
        let found =
            tauri::async_runtime::block_on(probe(candidates(&status, &address).unwrap())).unwrap();
        assert!(found.contains(&expected), "Expected service did not answer");
        println!(
            "Verified selected-peer services: {}",
            serde_json::to_string(&found).unwrap()
        );
    }
}
