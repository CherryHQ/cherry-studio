import Foundation

public enum JSONLineFramingError: Error, Equatable, Sendable {
    case lineTooLong
    case incompleteLine
}

public struct JSONLineFramer: Sendable {
    public static let maxLineBytes = 1024 * 1024

    private var bufferedLine = Data()
    private var isDiscardingOversizedLine = false

    public init() {}

    public mutating func append(_ data: Data) -> [Result<Data, JSONLineFramingError>] {
        var frames: [Result<Data, JSONLineFramingError>] = []
        var offset = data.startIndex

        while offset < data.endIndex {
            if isDiscardingOversizedLine {
                guard let lineFeedIndex = data[offset...].firstIndex(of: 0x0a) else {
                    return frames
                }

                isDiscardingOversizedLine = false
                offset = data.index(after: lineFeedIndex)
                continue
            }

            let lineFeedIndex = data[offset...].firstIndex(of: 0x0a)
            let segmentEnd = lineFeedIndex ?? data.endIndex
            let segment = data[offset..<segmentEnd]

            if segment.count > Self.maxLineBytes - bufferedLine.count {
                frames.append(.failure(.lineTooLong))
                bufferedLine.removeAll(keepingCapacity: true)

                guard let lineFeedIndex else {
                    isDiscardingOversizedLine = true
                    return frames
                }

                offset = data.index(after: lineFeedIndex)
                continue
            }

            bufferedLine.append(contentsOf: segment)

            guard let lineFeedIndex else {
                return frames
            }

            frames.append(.success(bufferedLine))
            bufferedLine = Data()
            offset = data.index(after: lineFeedIndex)
        }

        return frames
    }

    public mutating func finish() -> [Result<Data, JSONLineFramingError>] {
        guard !bufferedLine.isEmpty || isDiscardingOversizedLine else {
            return []
        }

        bufferedLine.removeAll(keepingCapacity: true)
        isDiscardingOversizedLine = false
        return [.failure(.incompleteLine)]
    }
}
