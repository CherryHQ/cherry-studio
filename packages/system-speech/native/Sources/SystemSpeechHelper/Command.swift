import Foundation

enum Operation: String, Codable, Sendable {
    case capabilities
    case listAsrLocales = "list_asr_locales"
    case installAsrAssets = "install_asr_assets"
    case transcribe
    case synthesize
}

struct NativeRequest: Decodable, Sendable {
    let operation: Operation
    let locale: String?
    let confirmDownload: Bool?
    let inputPath: String?
    let voiceId: String?
    let text: String?
    let outputPath: String?
}

enum ValidatedCommand: Sendable {
    case capabilities(locale: String)
    case listAsrLocales
    case installAsrAssets(locale: String)
    case transcribe(locale: String, inputPath: String)
    case synthesize(voiceId: String, text: String, outputPath: String)
}

extension NativeRequest {
    func validated() throws -> ValidatedCommand {
        switch operation {
        case .capabilities:
            return .capabilities(locale: try required(locale))
        case .listAsrLocales:
            return .listAsrLocales
        case .installAsrAssets:
            guard confirmDownload == true else { throw HelperError(code: .invalidRequest) }
            return .installAsrAssets(locale: try required(locale))
        case .transcribe:
            return .transcribe(locale: try required(locale), inputPath: try required(inputPath))
        case .synthesize:
            return .synthesize(
                voiceId: try required(voiceId),
                text: try required(text),
                outputPath: try required(outputPath)
            )
        }
    }

    private func required(_ value: String?) throws -> String {
        guard let value, !value.isEmpty else { throw HelperError(code: .invalidRequest) }
        return value
    }
}

enum ErrorCode: String, Encodable, Sendable {
    case unsupportedOs = "unsupported_os"
    case unsupportedLocale = "unsupported_locale"
    case assetRequired = "asset_required"
    case assetInstallationFailed = "asset_installation_failed"
    case voiceUnavailable = "voice_unavailable"
    case transcriptionFailed = "transcription_failed"
    case synthesisFailed = "synthesis_failed"
    case cancelled
    case invalidRequest = "invalid_request"
    case nativeHelperFailed = "native_helper_failed"
}

struct HelperError: Error, Encodable, Sendable {
    let code: ErrorCode
    let message: String

    init(code: ErrorCode, message: String? = nil) {
        self.code = code
        self.message = message ?? code.rawValue
    }
}

struct FailureEnvelope: Encodable, Sendable {
    let ok = false
    let error: HelperError
}

struct SuccessEnvelope<Value: Encodable & Sendable>: Encodable, Sendable {
    let ok = true
    let value: Value
}

enum AppleAssetStatus: String, Encodable, Sendable {
    case unsupported
    case supported
    case downloading
    case installed
}

struct InstalledVoice: Encodable, Sendable {
    let id: String
    let name: String
    let locale: String
    let quality: Int
}

struct CapabilitiesResult: Encodable, Sendable {
    let osVersion: String
    let requestedLocale: String
    let supportedLocale: String?
    let appleAssetStatus: AppleAssetStatus
    let voices: [InstalledVoice]
}

struct CapabilitiesSuccess: Encodable, Sendable {
    let operation = "capabilities"
    let result: CapabilitiesResult
}

struct AsrLocalesResult: Encodable, Sendable {
    let supported: [String]
    let installed: [String]
}

struct AsrLocalesSuccess: Encodable, Sendable {
    let operation = "list_asr_locales"
    let result: AsrLocalesResult
}

struct InstallAsrAssetsResult: Encodable, Sendable {
    let locale: String
    let status = "installed"
}

struct InstallAsrAssetsSuccess: Encodable, Sendable {
    let operation = "install_asr_assets"
    let result: InstallAsrAssetsResult
}

struct SynthesizeResult: Encodable, Sendable {
    let voiceId: String
    let outputPath: String
    let sampleRate: Int
    let channels: Int
    let frameCount: Int
}

struct SynthesizeSuccess: Encodable, Sendable {
    let operation = "synthesize"
    let result: SynthesizeResult
}

struct TranscribeResult: Encodable, Sendable {
    let locale: String
    let text: String
}

struct TranscribeSuccess: Encodable, Sendable {
    let operation = "transcribe"
    let result: TranscribeResult
}
