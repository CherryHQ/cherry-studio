import AVFAudio
import Foundation
import Testing
@testable import SystemSpeechHelper

@Suite("Native command contract")
struct CommandTests {
    @Test(arguments: [
        #"{"operation":"capabilities","locale":"zh-CN"}"#,
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

    @Test(arguments: [0.5, 1.0, 2.0])
    func mapsProductSpeedToAppleRate(speed: Double) throws {
        let expected = min(
            max(AVSpeechUtteranceDefaultSpeechRate * Float(speed), AVSpeechUtteranceMinimumSpeechRate),
            AVSpeechUtteranceMaximumSpeechRate
        )

        #expect(try AppleTts.rate(forMultiplier: speed) == expected)
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
