import AVFAudio
import Foundation
import Speech

struct AppleAsrCapability: Sendable {
    let supportedLocale: String?
    let assetStatus: AppleAssetStatus
}

enum AppleAsr {
    static func listLocales() async -> AsrLocalesResult {
        guard #available(macOS 26.0, *) else {
            return AppleLegacyAsr.listLocales()
        }

        return localesResult(
            supported: await SpeechTranscriber.supportedLocales,
            installed: await SpeechTranscriber.installedLocales
        )
    }

    static func localesResult(supported: [Locale], installed: [Locale]) -> AsrLocalesResult {
        func identifiers(_ locales: [Locale]) -> [String] {
            Array(Set(locales.map { $0.identifier.replacingOccurrences(of: "_", with: "-") })).sorted()
        }

        return AsrLocalesResult(supported: identifiers(supported), installed: identifiers(installed))
    }

    static func capabilities(locale identifier: String) async -> AppleAsrCapability {
        guard #available(macOS 26.0, *) else {
            return AppleLegacyAsr.capabilities(locale: identifier)
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

    static func transcribe(locale identifier: String, inputPath: String) async throws -> TranscribeResult {
        guard #available(macOS 26.0, *) else {
            return try await AppleLegacyAsr.transcribe(locale: identifier, inputPath: inputPath)
        }

        guard let supported = await SpeechTranscriber.supportedLocale(
            equivalentTo: Locale(identifier: identifier)
        ) else {
            throw HelperError(code: .unsupportedLocale)
        }

        let transcriber = SpeechTranscriber(locale: supported, preset: .transcription)
        guard await AssetInventory.status(forModules: [transcriber]) == .installed else {
            throw HelperError(code: .assetRequired)
        }

        do {
            let audioFile = try AVAudioFile(forReading: URL(fileURLWithPath: inputPath))
            let analyzer = SpeechAnalyzer(modules: [transcriber])
            let resultTask = Task { () throws -> String in
                var segments: [String] = []
                for try await result in transcriber.results where result.isFinal {
                    segments.append(String(result.text.characters))
                }
                return segments.joined()
            }

            do {
                try await analyzer.start(inputAudioFile: audioFile, finishAfterFile: true)
                return TranscribeResult(locale: supported.identifier, text: try await resultTask.value)
            } catch {
                resultTask.cancel()
                await analyzer.cancelAndFinishNow()
                throw error
            }
        } catch let error as HelperError {
            throw error
        } catch is CancellationError {
            throw HelperError(code: .cancelled)
        } catch {
            throw HelperError(code: .transcriptionFailed)
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
