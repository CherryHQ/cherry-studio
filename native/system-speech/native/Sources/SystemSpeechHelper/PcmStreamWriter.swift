import AVFAudio
import Foundation

/// Serialized by the synthesis callback owner; stdout backpressure bounds retained PCM.
final class PcmStreamWriter {
    private let output: FileHandle
    private var format: AVAudioFormat?
    private var frames = 0

    init(output: FileHandle = .standardOutput) {
        self.output = output
    }

    func receive(_ buffer: AVAudioPCMBuffer) throws {
        if buffer.frameLength == 0 {
            guard frames > 0 else { throw HelperError(code: .synthesisFailed) }
            try write(End(frames: frames))
            return
        }
        let channels = Int(buffer.format.channelCount)
        let rate = buffer.format.sampleRate
        guard buffer.format.commonFormat == .pcmFormatFloat32,
              (1 ... 2).contains(channels), rate.isFinite,
              (8000 ... 192000).contains(rate), rate.rounded() == rate,
              let data = buffer.floatChannelData
        else { throw HelperError(code: .synthesisFailed) }
        if let format {
            guard format == buffer.format else { throw HelperError(code: .synthesisFailed) }
        } else {
            format = buffer.format
            try write(Format(sampleRate: Int(rate), channels: channels))
        }
        for offset in stride(from: 0, to: Int(buffer.frameLength), by: 1024) {
            let count = min(1024, Int(buffer.frameLength) - offset)
            var bytes = Data(capacity: count * channels * 4)
            for frame in offset ..< offset + count {
                for channel in 0 ..< channels {
                    let sample = buffer.format.isInterleaved ? data[0][frame * channels + channel] : data[channel][frame]
                    guard sample.isFinite else { throw HelperError(code: .synthesisFailed) }
                    var bits = sample.bitPattern.littleEndian
                    withUnsafeBytes(of: &bits) { bytes.append(contentsOf: $0) }
                }
            }
            try write(Pcm(startFrame: frames, data: bytes.base64EncodedString()))
            frames += count
        }
    }

    private func write<Value: Encodable>(_ value: Value) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .withoutEscapingSlashes
        var data = try encoder.encode(value)
        data.append(0x0A)
        try output.write(contentsOf: data)
    }

    private struct Format: Encodable {
        let type = "format"
        let sampleRate: Int
        let channels: Int
    }

    private struct Pcm: Encodable {
        let type = "pcm"
        let startFrame: Int
        let data: String
    }

    private struct End: Encodable {
        let type = "end"
        let frames: Int
    }
}
