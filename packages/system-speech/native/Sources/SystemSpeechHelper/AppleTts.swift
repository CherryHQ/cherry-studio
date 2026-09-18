import AVFAudio
import Foundation

enum AppleTts {
    static func installedVoices() -> [InstalledVoice] {
        AVSpeechSynthesisVoice.speechVoices()
            .map { voice in
                InstalledVoice(
                    id: voice.identifier,
                    name: voice.name,
                    locale: voice.language,
                    quality: voice.quality.rawValue
                )
            }
            .sorted { $0.id < $1.id }
    }

    static func synthesize(voiceId: String, text: String, outputPath: String) async throws -> SynthesizeResult {
        guard let voice = AVSpeechSynthesisVoice(identifier: voiceId) else {
            throw HelperError(code: .voiceUnavailable)
        }

        let url = URL(fileURLWithPath: outputPath)
        try? FileManager.default.removeItem(at: url)

        do {
            try await write(voice: voice, text: text, to: url)
            let metadata = try WavInspection.inspectFile(at: outputPath)
            return SynthesizeResult(
                voiceId: voiceId,
                outputPath: outputPath,
                sampleRate: metadata.sampleRate,
                channels: metadata.channels,
                frameCount: metadata.frameCount
            )
        } catch let error as HelperError {
            throw error
        } catch {
            try? FileManager.default.removeItem(at: url)
            throw HelperError(code: .synthesisFailed)
        }
    }

    private static func write(voice: AVSpeechSynthesisVoice, text: String, to url: URL) async throws {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = voice
        let synthesizer = AVSpeechSynthesizer()

        try await withCheckedThrowingContinuation { continuation in
            let state = WavWriteState(url: url, synthesizer: synthesizer, continuation: continuation)
            synthesizer.write(utterance) { buffer in
                state.receive(buffer)
            }
        }
    }
}

private final class WavWriteState: @unchecked Sendable {
    private let lock = NSLock()
    private let url: URL
    private var audioFile: AVAudioFile?
    private var synthesizer: AVSpeechSynthesizer?
    private var continuation: CheckedContinuation<Void, any Error>?

    init(
        url: URL,
        synthesizer: AVSpeechSynthesizer,
        continuation: CheckedContinuation<Void, any Error>
    ) {
        self.url = url
        self.synthesizer = synthesizer
        self.continuation = continuation
    }

    func receive(_ buffer: AVAudioBuffer) {
        lock.lock()
        defer { lock.unlock() }
        guard let continuation else { return }
        guard let buffer = buffer as? AVAudioPCMBuffer else {
            finish(continuation, with: .failure(HelperError(code: .synthesisFailed)))
            return
        }

        if buffer.frameLength == 0 {
            finish(continuation, with: .success(()))
            return
        }

        do {
            if audioFile == nil {
                audioFile = try AVAudioFile(forWriting: url, settings: buffer.format.settings)
            }
            try audioFile?.write(from: buffer)
        } catch {
            finish(continuation, with: .failure(error))
        }
    }

    private func finish(_ continuation: CheckedContinuation<Void, any Error>, with result: Result<Void, any Error>) {
        audioFile = nil
        synthesizer = nil
        self.continuation = nil
        continuation.resume(with: result)
    }
}
