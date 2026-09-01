# VibeXStudio Privacy Policy

Effective: August 31, 2026

VibeXStudio is offered by Automated AI Solutions LLC. It is a local-first,
open-source app with no ads, analytics, or telemetry, and it does not sell
personal information. Most app data stays on the device unless you choose a
feature that sends it to another service. Those routes are described below.

## Data stored on your device

Projects, generated files, chat history, app settings, paired-service details,
and media are stored locally. Provider keys, OAuth tokens, GitHub tokens, and
Private VibeX device credentials are stored in the operating system keychain.
VibeXStudio does not upload this local data merely because the app is opened.

Deleting the app normally removes its local app data. Keychain behavior is
controlled by the operating system and may differ when an app is reinstalled
or a device is restored.

## AI providers and subscriptions

When you connect an AI provider or subscription and send a request,
VibeXStudio sends the prompt and any files or context you selected directly to
that provider's endpoint. The provider processes that data under its own terms
and privacy policy. VibeXStudio does not receive those direct-provider
requests on a VibeXStudio server.

## Optional Private VibeX access

Private VibeX is an optional, invite-only connection. Before it is saved, the
app displays a review screen explaining that prompts and generated output pass
through the disclosed private broker and its upstream model provider.

Redeeming an invite sends the one-time invite token, a randomly generated
installation proof, the app bundle identifier, app version and build, and a
one-time nonce to the broker. The broker stores hashed credentials and device
proofs, grant and device identifiers, expiry/revocation state, recipient label,
and usage counters. Its event logs can include event status, grant/device
identifiers, and the requested model. The broker source is designed not to
persist prompt or generated-output bodies, although those bodies pass through
the broker transiently to complete a request. Broker operational records may
remain after expiry or revocation until the operator removes them.

You can remove a Private VibeX connection in Settings. The app then requests
revocation and deletes the local connection credentials. The issuer may also
revoke the connection.

## GitHub and published projects

GitHub access is optional. If you connect GitHub, VibeXStudio sends the token
and project content needed for the GitHub action you request directly to
GitHub. Publishing a project can make that project public under your GitHub
account. Review the repository and visibility before publishing.

## Files and user-chosen storage

On Apple devices, projects remain in local app storage in this release. You can
export or import `.vibex` files through the operating system's ordinary Files,
AirDrop, and share-sheet interfaces. On supported non-Apple platforms, you may
choose a folder or service for project mirroring. Any storage provider you
choose operates under its own terms and privacy policy.

## Media Lab and local network access

You may pair a Media Lab, workbench, or approved agent on your local network
or tailnet. VibeXStudio uses local network access only to reach services you
choose to pair. Requests and project content sent to a paired service are
processed by that service. A configured cloud rendering provider receives the
media request and selected inputs needed to render it.

## Microphone, speech recognition, camera, and photos

Microphone and speech recognition access are optional and used for dictation.
The operating system's speech-recognition service may process audio according
to the device's settings and Apple's policies. VibeXStudio places the returned
transcript into the prompt field and does not intentionally store raw dictated
audio.

Camera and photo-library access are optional and occur only when you choose to
capture or select media for a project. Selected media becomes part of the
local project and is sent elsewhere only when you invoke a feature that needs
it, such as an AI request, sync, sharing, or publishing.

## Notifications

VibeXStudio can request notification permission to tell you that a local build
or Media Lab render finished or needs attention. Notification settings are
controlled by the operating system.

## Children

VibeXStudio is a developer tool and is not directed to children under 13.

## Changes and contact

Material changes to this policy will be reflected in this file with a new
effective date. For privacy questions or support, open an issue at
https://github.com/kerpopule/vibexstudio.
