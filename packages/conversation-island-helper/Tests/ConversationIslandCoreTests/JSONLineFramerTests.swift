import Foundation
import XCTest
@testable import ConversationIslandCore

final class JSONLineFramerTests: XCTestCase {
    func testBuffersPartialLineUntilLineFeed() throws {
        var framer = JSONLineFramer()
        XCTAssertTrue(framer.append(Data("partial".utf8)).isEmpty)

        let frames = framer.append(Data(" line\n".utf8))
        XCTAssertEqual(try XCTUnwrap(frames.first).get(), Data("partial line".utf8))
    }

    func testEmitsMultipleLinesIncludingAnEmptyLine() throws {
        var framer = JSONLineFramer()
        let frames = framer.append(Data("first\n\nthird\n".utf8))

        XCTAssertEqual(try frames[0].get(), Data("first".utf8))
        XCTAssertEqual(try frames[1].get(), Data())
        XCTAssertEqual(try frames[2].get(), Data("third".utf8))
    }

    func testPreservesEmojiSplitAcrossChunks() throws {
        var framer = JSONLineFramer()
        let encoded = Data("{\"title\":\"🤖\"}\n".utf8)
        let emojiStart = try XCTUnwrap(encoded.firstRange(of: Data("🤖".utf8)))
        let splitIndex = emojiStart.lowerBound + 2

        XCTAssertTrue(framer.append(encoded[..<splitIndex]).isEmpty)
        let frames = framer.append(encoded[splitIndex...])
        XCTAssertEqual(try XCTUnwrap(frames.first).get(), Data("{\"title\":\"🤖\"}".utf8))
    }

    func testAcceptsLineExactlyAtByteLimit() throws {
        var framer = JSONLineFramer()
        var input = Data(repeating: 0x61, count: JSONLineFramer.maxLineBytes)
        input.append(0x0a)

        let frames = framer.append(input)
        XCTAssertEqual(try XCTUnwrap(frames.first).get().count, JSONLineFramer.maxLineBytes)
    }

    func testReportsOversizedLineOnlyOnceWhileDiscarding() {
        var framer = JSONLineFramer()
        let firstFrames = framer.append(Data(repeating: 0x61, count: JSONLineFramer.maxLineBytes + 1))
        XCTAssertEqual(firstFrames.count, 1)
        assertFailure(firstFrames[0], equals: .lineTooLong)

        XCTAssertTrue(framer.append(Data("still discarded".utf8)).isEmpty)
    }

    func testRecoversAfterDiscardingOversizedLineThroughLineFeed() throws {
        var framer = JSONLineFramer()
        _ = framer.append(Data(repeating: 0x61, count: JSONLineFramer.maxLineBytes + 1))

        let frames = framer.append(Data("discarded\nvalid\n".utf8))
        XCTAssertEqual(frames.count, 1)
        XCTAssertEqual(try frames[0].get(), Data("valid".utf8))
    }

    func testReportsAndClearsIncompleteLineAtEOF() {
        var framer = JSONLineFramer()
        XCTAssertTrue(framer.append(Data("partial".utf8)).isEmpty)

        let frames = framer.finish()
        XCTAssertEqual(frames.count, 1)
        assertFailure(frames[0], equals: .incompleteLine)
        XCTAssertTrue(framer.finish().isEmpty)
    }

    func testReportsDiscardedOversizedTailAsIncompleteAtEOF() {
        var framer = JSONLineFramer()
        _ = framer.append(Data(repeating: 0x61, count: JSONLineFramer.maxLineBytes + 1))

        let frames = framer.finish()
        XCTAssertEqual(frames.count, 1)
        assertFailure(frames[0], equals: .incompleteLine)
    }

    func testInvalidUTF8FailsProtocolDecodeWithoutStoppingLaterFrames() throws {
        var framer = JSONLineFramer()
        var input = Data([0xc3, 0x28, 0x0a])
        input.append(Data(#"{"version":1,"type":"shutdown"}"#.utf8))
        input.append(0x0a)

        let frames = framer.append(input)
        XCTAssertEqual(frames.count, 2)
        XCTAssertThrowsError(try ParentCommand.decode(data: frames[0].get()))
        guard case .shutdown = try ParentCommand.decode(data: frames[1].get()) else {
            return XCTFail("expected shutdown command")
        }
    }

    private func assertFailure(
        _ result: Result<Data, JSONLineFramingError>,
        equals expected: JSONLineFramingError,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        switch result {
        case .success:
            XCTFail("expected framing error", file: file, line: line)
        case let .failure(error):
            XCTAssertEqual(error, expected, file: file, line: line)
        }
    }
}
