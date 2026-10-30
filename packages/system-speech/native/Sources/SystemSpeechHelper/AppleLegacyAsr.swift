import Foundation
import Speech

enum AppleLegacyAsr {
    static func listLocales() -> AsrLocalesResult {
        let offline = Array(SFSpeechRecognizer.supportedLocales().filter { locale in
            availableRecognizer(locale: locale) != nil
        })
        return AppleAsr.localesResult(supported: offline, installed: offline)
    }

    static func capabilities(locale identifier: String) -> AppleAsrCapability {
        guard let recognizer = availableRecognizer(locale: Locale(identifier: identifier)) else {
            return AppleAsrCapability(supportedLocale: nil, assetStatus: .unsupported)
        }
        return AppleAsrCapability(supportedLocale: recognizer.locale.identifier, assetStatus: .installed)
    }

    static func transcribe(locale identifier: String, inputPath: String) async throws -> TranscribeResult {
        guard let recognizer = availableRecognizer(locale: Locale(identifier: identifier)) else {
            throw HelperError(code: .unsupportedLocale)
        }
        guard let usage = Bundle.main.object(forInfoDictionaryKey: "NSSpeechRecognitionUsageDescription") as? String,
              !usage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw HelperError(code: .transcriptionFailed)
        }

        let authorization = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
        guard authorization == .authorized else {
            throw HelperError(code: .transcriptionFailed)
        }

        let request = recognitionRequest(inputPath: inputPath)
        do {
            let state = RecognitionState()
            defer { withExtendedLifetime(state) {} }
            let text = try await withCheckedThrowingContinuation { continuation in
                state.begin(continuation: continuation)
                let task = recognizer.recognitionTask(with: request) { [weak state] result, error in
                    state?.receive(result: result, error: error)
                }
                state.retain(task: task)
            }
            return TranscribeResult(locale: recognizer.locale.identifier, text: text)
        } catch {
            throw HelperError(code: .transcriptionFailed)
        }
    }

    static func recognitionRequest(inputPath: String) -> SFSpeechURLRecognitionRequest {
        let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: inputPath))
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = false
        return request
    }

    private static func availableRecognizer(locale: Locale) -> SFSpeechRecognizer? {
        guard let recognizer = SFSpeechRecognizer(locale: locale),
              recognizer.supportsOnDeviceRecognition,
              recognizer.isAvailable else {
            return nil
        }
        return recognizer
    }
}

final class RecognitionState: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<String, any Error>?
    private var task: SFSpeechRecognitionTask?

    func begin(continuation: CheckedContinuation<String, any Error>) {
        lock.lock()
        self.continuation = continuation
        lock.unlock()
    }

    func retain(task: SFSpeechRecognitionTask) {
        lock.lock()
        if continuation != nil {
            self.task = task
        }
        lock.unlock()
    }

    func receive(result: SFSpeechRecognitionResult?, error: (any Error)?) {
        lock.lock()
        guard let continuation else {
            lock.unlock()
            return
        }
        let completion: Result<String, any Error>
        if let error {
            completion = .failure(error)
        } else if let result, result.isFinal {
            completion = .success(result.bestTranscription.formattedString)
        } else {
            lock.unlock()
            return
        }
        self.continuation = nil
        task = nil
        lock.unlock()
        continuation.resume(with: completion)
    }
}
