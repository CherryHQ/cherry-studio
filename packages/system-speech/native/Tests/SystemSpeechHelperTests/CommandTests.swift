import Foundation
import Testing
@testable import SystemSpeechHelper

@Suite("Native command contract")
struct CommandTests {
    @Test
    func encodesMissingDefaultVoiceAsNull() throws {
        let data = try JSONEncoder().encode(ResolveVoiceResult(voice: nil))
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["voice"] is NSNull)
    }

    @Test
    func preservesDefaultVoiceLocaleAndRejectsEmptyLocale() throws {
        let data = Data(#"{"operation":"resolve_voice","locale":"zh-CN"}"#.utf8)
        let command = try JSONDecoder().decode(NativeRequest.self, from: data).validated()
        guard case let .resolveVoice(locale) = command else {
            Issue.record("Expected resolve_voice command")
            return
        }
        #expect(locale == "zh-CN")
        let invalid = Data(#"{"operation":"resolve_voice","locale":""}"#.utf8)
        #expect(throws: HelperError.self) {
            try JSONDecoder().decode(NativeRequest.self, from: invalid).validated()
        }
    }

    @Test
    func encodesUnsupportedLocaleAsExplicitNull() throws {
        let result = CapabilitiesResult(
            osVersion: "26.0", requestedLocale: "unsupported", supportedLocale: nil,
            appleAssetStatus: .unsupported, voices: []
        )
        let data = try JSONEncoder().encode(result)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

        #expect(object["supportedLocale"] is NSNull)
        #expect(object["appleAssetStatus"] as? String == "unsupported")
    }

    @Test(arguments: [
        #"{"operation":"capabilities","locale":"zh-CN"}"#,
        #"{"operation":"list_asr_locales"}"#,
        #"{"operation":"install_asr_assets","locale":"zh-CN","confirmDownload":true}"#,
        #"{"operation":"transcribe","locale":"zh-CN","inputPath":"/tmp/input.wav"}"#,
        #"{"operation":"synthesize","voiceId":"voice","text":"hello","outputPath":"/tmp/output.wav","speed":1.25}"#,
    ])
    func decodesSupportedOperations(json: String) throws {
        let request = try JSONDecoder().decode(NativeRequest.self, from: Data(json.utf8))

        #expect(throws: Never.self) {
            _ = try request.validated()
        }
    }

    @Test
    func preservesExactSynthesisSpeed() throws {
        let json = #"{"operation":"synthesize","voiceId":"voice","text":"hello","outputPath":"/tmp/output.wav","speed":1.25}"#
        let request = try JSONDecoder().decode(NativeRequest.self, from: Data(json.utf8))
        let command = try request.validated()

        guard case let .synthesize(_, _, _, speed) = command else {
            Issue.record("Expected synthesize command")
            return
        }
        #expect(speed == 1.25)
    }

    @Test(arguments: [
        #"{"operation":"synthesize","voiceId":"voice","text":"hello","outputPath":"/tmp/output.wav"}"#,
        #"{"operation":"synthesize","voiceId":"voice","text":"hello","outputPath":"/tmp/output.wav","speed":0.49}"#,
        #"{"operation":"synthesize","voiceId":"voice","text":"hello","outputPath":"/tmp/output.wav","speed":2.01}"#,
    ])
    func rejectsMissingOrUnsupportedSynthesisSpeed(json: String) throws {
        let request = try JSONDecoder().decode(NativeRequest.self, from: Data(json.utf8))

        #expect(throws: HelperError.self) {
            _ = try request.validated()
        }
    }

    @Test(arguments: [Double.nan, Double.infinity, -Double.infinity])
    func rejectsNonFiniteSynthesisSpeed(speed: Double) {
        let request = NativeRequest(
            operation: .synthesize,
            locale: nil,
            confirmDownload: nil,
            inputPath: nil,
            voiceId: "voice",
            text: "private-command-canary",
            outputPath: "/private/output-canary.wav",
            speed: speed
        )

        #expect(throws: HelperError.self) {
            _ = try request.validated()
        }
    }

    @Test
    func normalizesAndSortsAsrLocaleIdentifiers() {
        let result = AppleAsr.localesResult(
            supported: [Locale(identifier: "zh_CN"), Locale(identifier: "en_US"), Locale(identifier: "zh-CN")],
            installed: [Locale(identifier: "zh_CN"), Locale(identifier: "zh-CN")]
        )

        #expect(result.supported == ["en-US", "zh-CN"])
        #expect(result.installed == ["zh-CN"])
    }

    @Test
    func listsDeviceAsrLocales() async {
        let result = await AppleAsr.listLocales()

        #expect(result.supported == result.supported.sorted())
        #expect(result.supported.count == Set(result.supported).count)
        #expect(result.supported.allSatisfy { !$0.contains("_") })
    }

    @Test
    func installedLocalesAreReadyForTranscription() async {
        let result = await AppleAsr.listLocales()
        for locale in result.supported {
            let capability = await AppleAsr.capabilities(locale: locale)
            #expect(result.installed.contains(locale) == (capability.assetStatus == .installed))
        }
    }

    @Test(arguments: [
        #"{"operation":"install_asr_assets","locale":"zh-CN"}"#,
        #"{"operation":"install_asr_assets","locale":"zh-CN","confirmDownload":false}"#,
    ])
    func rejectsInstallWithoutExplicitConfirmation(json: String) throws {
        let request = try JSONDecoder().decode(NativeRequest.self, from: Data(json.utf8))

        #expect(throws: HelperError.self) {
            _ = try request.validated()
        }
    }

    @Test
    func rejectsUnknownOperation() {
        let json = #"{"operation":"recognize","locale":"zh-CN"}"#

        #expect(throws: DecodingError.self) {
            _ = try JSONDecoder().decode(NativeRequest.self, from: Data(json.utf8))
        }
    }

    @Test
    func encodesStableFailureEnvelope() throws {
        let data = try JSONEncoder().encode(FailureEnvelope(error: HelperError(code: .invalidRequest)))
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let error = try #require(object["error"] as? [String: Any])

        #expect(object["ok"] as? Bool == false)
        #expect(error["code"] as? String == "invalid_request")
        #expect(error["message"] as? String == "invalid_request")
    }
}
