import Foundation

struct WavMetadata: Encodable, Sendable {
    let sampleRate: Int
    let channels: Int
    let frameCount: Int
}

enum WavInspection {
    static func inspect(_ data: Data) throws -> WavMetadata {
        guard data.count >= 12,
              String(data: data[0 ..< 4], encoding: .ascii) == "RIFF",
              String(data: data[8 ..< 12], encoding: .ascii) == "WAVE"
        else {
            throw HelperError(code: .synthesisFailed)
        }

        var sampleRate: Int?
        var channels: Int?
        var blockAlign: Int?
        var dataSize: Int?
        var offset = 12

        while offset + 8 <= data.count {
            let chunkId = String(data: data[offset ..< offset + 4], encoding: .ascii)
            let chunkSize = Int(readUInt32(data, at: offset + 4))
            let payloadOffset = offset + 8
            guard chunkSize <= data.count - payloadOffset else {
                throw HelperError(code: .synthesisFailed)
            }

            if chunkId == "fmt " {
                guard chunkSize >= 16 else { throw HelperError(code: .synthesisFailed) }
                channels = Int(readUInt16(data, at: payloadOffset + 2))
                sampleRate = Int(readUInt32(data, at: payloadOffset + 4))
                blockAlign = Int(readUInt16(data, at: payloadOffset + 12))
            } else if chunkId == "data" {
                dataSize = chunkSize
            }

            offset = payloadOffset + chunkSize + (chunkSize % 2)
        }

        guard let sampleRate, sampleRate > 0,
              let channels, channels > 0,
              let blockAlign, blockAlign > 0,
              let dataSize
        else {
            throw HelperError(code: .synthesisFailed)
        }

        return WavMetadata(
            sampleRate: sampleRate,
            channels: channels,
            frameCount: dataSize / blockAlign
        )
    }

    static func inspectFile(at path: String) throws -> WavMetadata {
        try inspect(Data(contentsOf: URL(fileURLWithPath: path)))
    }

    private static func readUInt16(_ data: Data, at offset: Int) -> UInt16 {
        UInt16(data[offset]) | UInt16(data[offset + 1]) << 8
    }

    private static func readUInt32(_ data: Data, at offset: Int) -> UInt32 {
        UInt32(data[offset])
            | UInt32(data[offset + 1]) << 8
            | UInt32(data[offset + 2]) << 16
            | UInt32(data[offset + 3]) << 24
    }
}
