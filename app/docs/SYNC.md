# Project storage and portability

VibeXStudio 1.1.0 build 26 is local-first. It does not provide first-party
account storage or Apple-device project sync in this release.

## Apple devices

Projects, chat history, generated files, and the on-device Media Lab gallery
remain in the app's local documents directory. Users can move copies through
ordinary operating-system workflows:

- export a `.vibex` bundle with the share sheet;
- import a `.vibex` file from Files, AirDrop, or another document provider;
- paste a direct bundle link, including supported Dropbox and Google Drive
  links.

These file operations do not create a VibeXStudio account and do not enable an
app-managed cloud-sync capability. Removing the app can remove local data, so
users should export projects they need to retain.

A previously implemented Apple sync bridge is preserved under
`dormant/icloud/` for a future, separately provisioned release. It is outside
the Expo local-module directory, is not imported by shipping code, and must not
be restored until the bundle ID, signing profile, UI, tests, disclosures, and
artifact entitlements are verified together.

## Android

- Android Auto Backup remains enabled for operating-system backup and restore.
- The user may choose a folder through the Storage Access Framework. The app
  mirrors project data to `<folder>/VibeXStudio/<projectId>/`.
- Sync is last-writer-wins per whole project. `project.json` is written last so
  interrupted transfers remain repairable on a later pass.
- The folder provider controls upload/download timing. Failures are best-effort
  and never make local project storage unavailable.

## Desktop

Desktop users can point storage at an ordinary synced folder. This is a
filesystem choice made by the user, not a VibeXStudio-hosted sync service.
