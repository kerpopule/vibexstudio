# Dormant integrations

Nothing under this directory is part of the VibeXStudio shipping source graph.
Shipping code must not import these files, Expo must not discover them as local
modules or routes, and release bundles must not contain their product/domain
markers.

- `icloud/` preserves the former Apple sync bridge for a future release that has
  separately provisioned iCloud entitlements, migration behavior, UI,
  disclosures, device tests, and signed-artifact verification.
- `refero/` preserves the former Refero Templates implementation pending written
  authorization for the integration and App Store collateral. Its model is
  self-contained here; the shipping `src/` domain model has no Refero schema.

Restoration is a new feature, not a file move. It requires an isolated task,
RED/GREEN tests, explicit product/legal approval where applicable, regenerated
native configuration, runtime evidence, and independent release QA.
