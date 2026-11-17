import AVFAudio
import Foundation
import Testing
@testable import SystemSpeechHelper

@Suite("PCM stream wire contract")
struct PcmStreamWriterTests {
    @Test(arguments: [false, true])
    func preservesStereoSamplesAndTailInBoundedFrames(interleaved: Bool) throws {
        let format = try #require(AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 2, interleaved: interleaved))
        let audio = try #require(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 2051))
        audio.frameLength = 2051
        let channels = try #require(audio.floatChannelData)
        for i in 0 ..< 2051 {
            if interleaved {
                channels[0][i * 2] = Float(i)
                channels[0][i * 2 + 1] = -Float(i)
            } else {
                channels[0][i] = Float(i)
                channels[1][i] = -Float(i)
            }
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        FileManager.default.createFile(atPath: url.path, contents: nil)
        defer { try? FileManager.default.removeItem(at: url) }
        let file = try FileHandle(forWritingTo: url)
        defer { try? file.close() }
        let writer = PcmStreamWriter(output: file)
        try writer.receive(audio)
        let tail = try #require(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1))
        try writer.receive(tail)
        let lines = try Data(contentsOf: url).split(separator: 10)
        #expect(lines.count == 5)
        let objects = try lines.map { try #require(JSONSerialization.jsonObject(with: Data($0)) as? [String: Any]) }
        #expect(objects[0]["sampleRate"] as? Int == 24000)
        #expect(objects[0]["channels"] as? Int == 2)
        #expect(objects.last?["frames"] as? Int == 2051)
        var expected = 0
        for object in objects.dropFirst().dropLast() {
            #expect(object["startFrame"] as? Int == expected)
            let encoded = try #require(object["data"] as? String)
            let bytes = try #require(Data(base64Encoded: encoded))
            #expect(bytes.count <= 1024 * 2 * 4)
            for offset in stride(from: 0, to: bytes.count, by: 8) {
                let left = bytes.withUnsafeBytes { Float(bitPattern: UInt32(littleEndian: $0.loadUnaligned(fromByteOffset: offset, as: UInt32.self))) }
                let right = bytes.withUnsafeBytes { Float(bitPattern: UInt32(littleEndian: $0.loadUnaligned(fromByteOffset: offset + 4, as: UInt32.self))) }
                #expect(left == Float(expected))
                #expect(right == -Float(expected))
                expected += 1
            }
        }
        #expect(expected == 2051)
    }

    @Test
    func keepsSlashHeavyStereoWithinWireLineLimit() throws {
        let format = try #require(AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 2))
        let audio = try #require(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024))
        audio.frameLength = 1024
        let channels = try #require(audio.floatChannelData)
        let sample = Float(bitPattern: 0xbf7fffff)
        for channel in 0 ..< 2 {
            for frame in 0 ..< 1024 { channels[channel][frame] = sample }
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        FileManager.default.createFile(atPath: url.path, contents: nil)
        defer { try? FileManager.default.removeItem(at: url) }
        let file = try FileHandle(forWritingTo: url)
        defer { try? file.close() }
        let writer = PcmStreamWriter(output: file)
        try writer.receive(audio)
        let tail = try #require(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1))
        try writer.receive(tail)
        let lines = try Data(contentsOf: url).split(separator: 10)
        #expect(lines.count == 3)
        for line in lines { #expect(line.count <= 16384) }
        let pcm = try #require(JSONSerialization.jsonObject(with: Data(lines[1])) as? [String: Any])
        let encoded = try #require(pcm["data"] as? String)
        let bytes = try #require(Data(base64Encoded: encoded))
        #expect(bytes.count == 8192)
        for offset in stride(from: 0, to: bytes.count, by: 4) {
            let bits = bytes.withUnsafeBytes { UInt32(littleEndian: $0.loadUnaligned(fromByteOffset: offset, as: UInt32.self)) }
            #expect(bits == sample.bitPattern)
        }
    }

    @Test
    func rejectsEmptyAndNonFiniteAudio() throws {
        let format = try #require(AVAudioFormat(standardFormatWithSampleRate: 22050, channels: 1))
        let audio = try #require(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1))
        let file = try FileHandle(forWritingTo: URL(fileURLWithPath: "/dev/null"))
        defer { try? file.close() }
        let writer = PcmStreamWriter(output: file)
        #expect(throws: HelperError.self) { try writer.receive(audio) }
        audio.frameLength = 1
        audio.floatChannelData?[0][0] = .nan
        #expect(throws: HelperError.self) { try writer.receive(audio) }
    }
}
