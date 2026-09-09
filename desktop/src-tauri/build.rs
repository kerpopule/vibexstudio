fn main() {
    println!("cargo:rerun-if-env-changed=VIBEX_CONTROLLER_PACKAGE_SHA256");
    let digest = std::env::var("VIBEX_CONTROLLER_PACKAGE_SHA256").unwrap_or_default();
    assert!(digest.is_empty() || (digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit())), "Invalid controller package digest");
    println!("cargo:rustc-env=VIBEX_CONTROLLER_PACKAGE_SHA256={}", digest);
    tauri_build::build()
}
