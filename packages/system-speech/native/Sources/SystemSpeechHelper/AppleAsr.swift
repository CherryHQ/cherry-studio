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

    static func installAssets(locale identifier: String) async throws -> String {
        guard #available(macOS 26.0, *) else {
            throw HelperError(code: .unsupportedOs)
        }

        guard let supported = await SpeechTranscriber.supportedLocale(
            equivalentTo: Locale(identifier: identifier)
        ) else {
            throw HelperError(code: .unsupportedLocale)
        }

        let transcriber = SpeechTranscriber(locale: supported, preset: .transcription)

        do {
            let initialStatus = await AssetInventory.status(forModules: [transcriber])
            switch initialStatus {
            case .unsupported:
                throw HelperError(code: .unsupportedLocale)
            case .installed:
                _ = try await AssetInventory.reserve(locale: supported)
                return supported.identifier
            case .supported, .downloading:
                guard let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) else {
                    throw HelperError(code: .assetInstallationFailed)
                }
                try await request.downloadAndInstall()
            @unknown default:
                throw HelperError(code: .assetInstallationFailed)
            }

            guard await AssetInventory.status(forModules: [transcriber]) == .installed else {
                throw HelperError(code: .assetInstallationFailed)
            }
            _ = try await AssetInventory.reserve(locale: supported)
            return supported.identifier
        } catch let error as HelperError {
            throw error
        } catch {
            throw HelperError(code: .assetInstallationFailed)
        }
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
