import Foundation
import Testing
@testable import SystemSpeechHelper

@Suite("Native command contract")
struct CommandTests {
    @Test(arguments: [
        #"{"operation":"capabilities","locale":"zh-CN"}"#,
        #"{"operation":"install_asr_assets","locale":"zh-CN","confirmDownload":true}"#,
        #"{"operation":"transcribe","locale":"zh-CN","inputPath":"/tmp/input.wav"}"#,
        #"{"operation":"synthesize","voiceId":"voice","text":"hello","outputPath":"/tmp/output.wav"}"#,
    ])
    func decodesSupportedOperations(json: String) throws {
        let request = try JSONDecoder().decode(NativeRequest.self, from: Data(json.utf8))

        #expect(throws: Never.self) {
            _ = try request.validated()
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
