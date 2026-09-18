import Foundation
import Speech

struct AppleAsrCapability: Sendable {
    let supportedLocale: String?
    let assetStatus: AppleAssetStatus
}

enum AppleAsr {
    static func capabilities(locale identifier: String) async -> AppleAsrCapability {
        guard #available(macOS 26.0, *) else {
            return AppleAsrCapability(supportedLocale: nil, assetStatus: .unsupported)
        }

        guard let supported = await SpeechTranscriber.supportedLocale(
            equivalentTo: Locale(identifier: identifier)
        ) else {
            return AppleAsrCapability(supportedLocale: nil, assetStatus: .unsupported)
        }

        let transcriber = SpeechTranscriber(locale: supported, preset: .transcription)
        let status = await AssetInventory.status(forModules: [transcriber])
        return AppleAsrCapability(
            supportedLocale: supported.identifier,
            assetStatus: AppleAssetStatus(status)
        )
    }
}

@available(macOS 26.0, *)
private extension AppleAssetStatus {
    init(_ status: AssetInventory.Status) {
        switch status {
        case .unsupported: self = .unsupported
        case .supported: self = .supported
        case .downloading: self = .downloading
        case .installed: self = .installed
        @unknown default: self = .unsupported
        }
    }
}
