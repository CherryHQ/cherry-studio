import AVFAudio
import Foundation

enum AppleTts {
    static func installedVoices() -> [InstalledVoice] {
        AVSpeechSynthesisVoice.speechVoices()
            .map(installedVoice)
            .sorted { $0.id < $1.id }
    }

    static func defaultVoice(locale: String?) -> InstalledVoice? {
        guard let voice = AVSpeechSynthesisVoice(language: locale) else { return nil }
        if let locale, voice.language.caseInsensitiveCompare(locale) != .orderedSame { return nil }
        guard AVSpeechSynthesisVoice.speechVoices().contains(where: { $0.identifier == voice.identifier }) else {
            return nil
        }
        return installedVoice(voice)
    }

    private static func installedVoice(_ voice: AVSpeechSynthesisVoice) -> InstalledVoice {
        InstalledVoice(id: voice.identifier, name: voice.name, locale: voice.language, quality: voice.quality.rawValue)
    }

    static func rate(forMultiplier multiplier: Double) throws -> Float {
        guard multiplier.isFinite, (0.5 ... 2.0).contains(multiplier) else {
            throw HelperError(code: .invalidRequest)
        }
        return min(
            max(AVSpeechUtteranceDefaultSpeechRate * Float(multiplier), AVSpeechUtteranceMinimumSpeechRate),
            AVSpeechUtteranceMaximumSpeechRate
        )
    }

    static func synthesize(
        voiceId: String,
        text: String,
        outputPath: String,
        speed: Double
    ) async throws -> SynthesizeResult {
        guard let voice = AVSpeechSynthesisVoice(identifier: voiceId) else {
            throw HelperError(code: .voiceUnavailable)
        }

        let url = URL(fileURLWithPath: outputPath)
        try? FileManager.default.removeItem(at: url)

        do {
            try await write(voice: voice, text: text, rate: try rate(forMultiplier: speed), destination: .wav(url))
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

    static func stream(voiceId: String, text: String, speed: Double) async throws {
        guard let voice = AVSpeechSynthesisVoice(identifier: voiceId) else {
            throw HelperError(code: .voiceUnavailable)
        }
        try await write(voice: voice, text: text, rate: try rate(forMultiplier: speed), destination: .stream)
    }

    private static func write(voice: AVSpeechSynthesisVoice, text: String, rate: Float, destination: SynthesisDestination) async throws {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = voice
        utterance.rate = rate
        let synthesizer = AVSpeechSynthesizer()

        try await withCheckedThrowingContinuation { continuation in
            let state = SpeechWriteState(destination: destination, synthesizer: synthesizer, continuation: continuation)
            synthesizer.write(utterance) { buffer in
                state.receive(buffer)
            }
        }
    }
}

private enum SynthesisDestination {
    case wav(URL)
    case stream
}

private final class SpeechWriteState: @unchecked Sendable {
    private let lock = NSLock()
    private let destination: SynthesisDestination
    private let pcmWriter: PcmStreamWriter?
    private var audioFile: AVAudioFile?
    private var synthesizer: AVSpeechSynthesizer?
    private var continuation: CheckedContinuation<Void, any Error>?

    init(
        destination: SynthesisDestination,
        synthesizer: AVSpeechSynthesizer,
        continuation: CheckedContinuation<Void, any Error>
    ) {
        self.destination = destination
        if case .stream = destination { pcmWriter = PcmStreamWriter() } else { pcmWriter = nil }
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

        do {
            if let pcmWriter {
                try pcmWriter.receive(buffer)
            } else if buffer.frameLength > 0, case let .wav(url) = destination {
                if audioFile == nil {
                    audioFile = try AVAudioFile(forWriting: url, settings: buffer.format.settings)
                }
                try audioFile?.write(from: buffer)
            }
            if buffer.frameLength == 0 {
                finish(continuation, with: .success(()))
            }
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
