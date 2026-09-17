import Foundation
import XCTest
@testable import ConversationIslandCore

final class ProtocolTests: XCTestCase {
    func testDecodesAllParentCommandFixtures() throws {
        let lines = try fixtureLines(named: "parent-commands")
        XCTAssertEqual(lines.count, 3)

        guard case let .present(revision, payload) = try ParentCommand.decode(line: lines[0]) else {
            return XCTFail("expected present command")
        }
        XCTAssertEqual(revision, 42)
        XCTAssertEqual(payload.displayId, 1)
        XCTAssertFalse(payload.expanded)
        XCTAssertFalse(payload.reducedMotion)
        XCTAssertEqual(payload.theme.appearance, .dark)
        XCTAssertEqual(payload.theme.primaryColor, "#00B96B")
        XCTAssertEqual(payload.theme.fontFamily, "")
        XCTAssertEqual(payload.primaryActivityId, "topic-1")
        XCTAssertEqual(payload.activityCountText, "2 个活动")
        XCTAssertEqual(payload.activities.map(\.activityId), ["topic-1", "topic-2"])
        XCTAssertEqual(payload.activities.map(\.state), [.streaming, .awaitingConfirmation])

        guard case let .dismiss(revision) = try ParentCommand.decode(line: lines[1]) else {
            return XCTFail("expected dismiss command")
        }
        XCTAssertEqual(revision, 43)

        guard case .shutdown = try ParentCommand.decode(line: lines[2]) else {
            return XCTFail("expected shutdown command")
        }
    }

    func testEncodesAllHelperEventFixturesAsSingleJSONLines() throws {
        let expectedLines = try fixtureLines(named: "helper-events")
        let events: [HelperEvent] = [
            .ready(pid: 4242),
            .setExpanded(revision: 42, expanded: true),
            .openActivity(revision: 42, activityId: "topic-1"),
            .hidden(revision: 43)
        ]
        XCTAssertEqual(expectedLines.count, events.count)

        for (event, expectedLine) in zip(events, expectedLines) {
            let encoded = try event.encodedLine()
            XCTAssertEqual(encoded.last, 0x0a)
            XCTAssertFalse(encoded.dropLast().contains(0x0a))
            XCTAssertEqual(try jsonObject(encoded), try jsonObject(Data(expectedLine.utf8)))
        }
    }

    func testAcceptsEmptyPresentationTextFields() throws {
        let line = try mutatedPresentLine { payload in
            payload["activityCountText"] = ""
            payload["theme"] = ["appearance": "light", "primaryColor": "", "fontFamily": ""]
            var activities = payload["activities"] as! [[String: Any]]
            activities[0]["identityAvatar"] = ""
            activities[0]["identityName"] = ""
            activities[0]["statusText"] = ""
            activities[0]["title"] = ""
            payload["activities"] = activities
        }

        guard case let .present(_, payload) = try ParentCommand.decode(line: line) else {
            return XCTFail("expected present command")
        }
        XCTAssertEqual(payload.activities[0].identityAvatar, "")
        XCTAssertEqual(payload.activities[0].identityName, "")
        XCTAssertEqual(payload.activities[0].statusText, "")
        XCTAssertEqual(payload.activities[0].title, "")
    }

    func testRejectsUnsupportedVersion() throws {
        var command = try presentJSONObject()
        command["version"] = 2

        XCTAssertThrowsError(try ParentCommand.decode(line: try jsonLine(command)))
    }

    func testRejectsUnknownCommandType() {
        XCTAssertThrowsError(
            try ParentCommand.decode(line: #"{"version":1,"type":"replace","revision":42}"#)
        )
    }

    func testRejectsUnknownActivityState() throws {
        let line = try mutatedPresentLine { payload in
            var activities = payload["activities"] as! [[String: Any]]
            activities[0]["state"] = "paused"
            payload["activities"] = activities
        }

        XCTAssertThrowsError(try ParentCommand.decode(line: line))
    }

    func testRejectsInvalidRevisions() {
        let invalidLines = [
            #"{"version":1,"type":"dismiss","revision":-1}"#,
            #"{"version":1,"type":"dismiss","revision":1.5}"#,
            #"{"version":1,"type":"dismiss","revision":9007199254740992}"#
        ]

        for line in invalidLines {
            XCTAssertThrowsError(try ParentCommand.decode(line: line))
        }
    }

    func testRejectsFractionalDisplayId() throws {
        let line = try mutatedPresentLine { $0["displayId"] = 1.5 }
        XCTAssertThrowsError(try ParentCommand.decode(line: line))
    }

    func testRejectsEmptyActivities() throws {
        let line = try mutatedPresentLine { $0["activities"] = [] }
        XCTAssertThrowsError(try ParentCommand.decode(line: line))
    }

    func testRejectsEmptyActivityId() throws {
        let line = try mutatedPresentLine { payload in
            payload["primaryActivityId"] = ""
            var activities = payload["activities"] as! [[String: Any]]
            activities[0]["activityId"] = ""
            payload["activities"] = activities
        }

        XCTAssertThrowsError(try ParentCommand.decode(line: line))
    }

    func testRejectsDuplicateActivityIds() throws {
        let line = try mutatedPresentLine { payload in
            let activities = payload["activities"] as! [[String: Any]]
            payload["activities"] = [activities[0], activities[0]]
        }

        XCTAssertThrowsError(try ParentCommand.decode(line: line))
    }

    func testRejectsMissingPrimaryActivity() throws {
        let line = try mutatedPresentLine { $0["primaryActivityId"] = "missing" }
        XCTAssertThrowsError(try ParentCommand.decode(line: line))
    }

    func testRejectsUnknownThemeAppearance() throws {
        let line = try mutatedPresentLine { payload in
            var theme = payload["theme"] as! [String: Any]
            theme["appearance"] = "system"
            payload["theme"] = theme
        }

        XCTAssertThrowsError(try ParentCommand.decode(line: line))
    }

    func testRejectsUnexpectedWireFields() throws {
        let line = try mutatedPresentLine { payload in
            var activities = payload["activities"] as! [[String: Any]]
            activities[0]["target"] = ["conversationId": "private-content"]
            payload["activities"] = activities
        }

        XCTAssertThrowsError(try ParentCommand.decode(line: line))
    }

    func testRejectsInvalidUTF8Data() {
        let invalidUTF8 = Data([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d])
        XCTAssertThrowsError(try ParentCommand.decode(data: invalidUTF8))
    }

    func testProtocolErrorsExposeOnlyKindTypeAndRevisionMetadata() throws {
        let line = try mutatedPresentLine { payload in
            var activities = payload["activities"] as! [[String: Any]]
            activities[0]["state"] = "private-state"
            activities[0]["title"] = "private-title"
            activities[0]["identityName"] = "private-identity"
            payload["activities"] = activities
        }

        do {
            _ = try ParentCommand.decode(line: line)
            XCTFail("expected invalid payload")
        } catch {
            let description = String(describing: error)
            XCTAssertEqual(description, "protocol-error kind=invalid-payload type=present revision=42")
            XCTAssertFalse(description.contains("private-state"))
            XCTAssertFalse(description.contains("private-title"))
            XCTAssertFalse(description.contains("private-identity"))
        }
    }

    func testRejectsNonpositiveReadyPids() {
        XCTAssertThrowsError(try HelperEvent.ready(pid: 0).encodedLine())
        XCTAssertThrowsError(try HelperEvent.ready(pid: -1).encodedLine())
    }

    func testRejectsInvalidHelperEventRevisionsAndActivityIds() {
        XCTAssertThrowsError(try HelperEvent.hidden(revision: -1).encodedLine())
        XCTAssertThrowsError(try HelperEvent.hidden(revision: 9_007_199_254_740_992).encodedLine())
        XCTAssertThrowsError(try HelperEvent.openActivity(revision: 1, activityId: "").encodedLine())
    }

    private func fixtureLines(named name: String) throws -> [String] {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: name, withExtension: "jsonl", subdirectory: "Fixtures")
        )
        let data = try Data(contentsOf: url)
        let contents = try XCTUnwrap(String(data: data, encoding: .utf8))
        XCTAssertTrue(contents.hasSuffix("\n"))
        return contents.split(separator: "\n").map(String.init)
    }

    private func presentJSONObject() throws -> [String: Any] {
        let line = try XCTUnwrap(fixtureLines(named: "parent-commands").first)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
    }

    private func mutatedPresentLine(_ mutate: (inout [String: Any]) -> Void) throws -> String {
        var command = try presentJSONObject()
        var payload = try XCTUnwrap(command["payload"] as? [String: Any])
        mutate(&payload)
        command["payload"] = payload
        return try jsonLine(command)
    }

    private func jsonLine(_ object: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        return try XCTUnwrap(String(data: data, encoding: .utf8))
    }

    private func jsonObject(_ data: Data) throws -> NSDictionary {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? NSDictionary)
    }
}
