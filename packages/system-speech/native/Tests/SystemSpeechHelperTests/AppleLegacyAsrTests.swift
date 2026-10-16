import Foundation
import Speech
import Testing
@testable import SystemSpeechHelper

@Suite("Legacy Apple speech privacy")
struct AppleLegacyAsrTests {
    @Test
    func fileRecognitionRequiresOnDeviceProcessing() {
        let request = AppleLegacyAsr.recognitionRequest(inputPath: "/private/input.wav")

        #expect(request.requiresOnDeviceRecognition)
        #expect(!request.shouldReportPartialResults)
    }

    @Test
    func completionReleasesRecognitionTask() async {
        let state = RecognitionState()
        weak var retainedTask: SFSpeechRecognitionTask?

        let text: String? = try? await withCheckedThrowingContinuation { continuation in
            state.begin(continuation: continuation)
            let task = SFSpeechRecognitionTask()
            retainedTask = task
            state.retain(task: task)
            state.receive(result: nil, error: HelperError(code: .transcriptionFailed))
            state.receive(result: nil, error: HelperError(code: .transcriptionFailed))
        }

        #expect(text == nil)
        #expect(retainedTask == nil)
    }
}
