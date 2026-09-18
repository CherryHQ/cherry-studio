import Foundation
import Testing
@testable import SystemSpeechHelper

@Suite("WAV inspection")
struct WavInspectionTests {
    @Test
    func readsPcmMetadata() throws {
        var data = Data("RIFF".utf8)
        data.append(contentsOf: littleEndian(UInt32(40)))
        data.append(Data("WAVEfmt ".utf8))
        data.append(contentsOf: littleEndian(UInt32(16)))
        data.append(contentsOf: littleEndian(UInt16(1)))
        data.append(contentsOf: littleEndian(UInt16(1)))
        data.append(contentsOf: littleEndian(UInt32(16_000)))
        data.append(contentsOf: littleEndian(UInt32(32_000)))
        data.append(contentsOf: littleEndian(UInt16(2)))
        data.append(contentsOf: littleEndian(UInt16(16)))
        data.append(Data("data".utf8))
        data.append(contentsOf: littleEndian(UInt32(4)))
        data.append(contentsOf: [0, 0, 0, 0])

        let metadata = try WavInspection.inspect(data)

        #expect(metadata.sampleRate == 16_000)
        #expect(metadata.channels == 1)
        #expect(metadata.frameCount == 2)
    }

    @Test
    func rejectsMissingDataChunk() {
        let data = Data("RIFF\0\0\0\0WAVE".utf8)

        #expect(throws: HelperError.self) {
            _ = try WavInspection.inspect(data)
        }
    }

    private func littleEndian<T: FixedWidthInteger>(_ value: T) -> [UInt8] {
        withUnsafeBytes(of: value.littleEndian, Array.init)
    }
}
