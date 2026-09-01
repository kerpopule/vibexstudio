import ExpoModulesCore

/**
 * iCloud Documents bridge for VibeXStudio's serverless device sync.
 *
 * Exposes the app's ubiquity container URL as a module constant (resolved
 * once, off the main thread is not allowed for constants, but the first
 * url(forUbiquityContainerIdentifier:) call is fast when iCloud is off and
 * the container is set up in the entitlements). When the user is signed out
 * of iCloud (or the entitlement is missing) the constant is nil and the app
 * stays on purely local storage.
 */
public class VibexIcloudModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VibexIcloud")

    Constants {
      var documentsUrl: String? = nil
      // nil identifier = the first container in the entitlements.
      if let container = FileManager.default.url(forUbiquityContainerIdentifier: nil) {
        let documents = container.appendingPathComponent("Documents", isDirectory: true)
        try? FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
        documentsUrl = documents.absoluteString
      }
      return ["icloudDocumentsUrl": documentsUrl as Any]
    }

    /// Ask the system to materialize a not-yet-downloaded iCloud item.
    AsyncFunction("downloadItem") { (url: String) in
      guard let itemUrl = URL(string: url) else { return }
      try? FileManager.default.startDownloadingUbiquitousItem(at: itemUrl)
    }
  }
}
