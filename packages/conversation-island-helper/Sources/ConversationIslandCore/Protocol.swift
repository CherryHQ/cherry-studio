import Foundation

public let conversationIslandProtocolVersion = 1
public let conversationIslandMaximumRevision: Int64 = 9_007_199_254_740_991

public enum ActivityState: String, Codable, Sendable {
    case pending
    case streaming
    case awaitingConfirmation = "awaiting-confirmation"
    case done
    case error
}

public enum ThemeAppearance: String, Codable, Sendable {
    case light
    case dark
}

public struct PresentationTheme: Codable, Equatable, Sendable {
    public let appearance: ThemeAppearance
    public let primaryColor: String
    public let fontFamily: String

    public init(appearance: ThemeAppearance, primaryColor: String, fontFamily: String) {
        self.appearance = appearance
        self.primaryColor = primaryColor
        self.fontFamily = fontFamily
    }

    public init(from decoder: any Decoder) throws {
        let container = try exactContainer(
            from: decoder,
            keys: ["appearance", "primaryColor", "fontFamily"]
        )
        appearance = try container.decode(ThemeAppearance.self, forKey: WireKey("appearance"))
        primaryColor = try container.decode(String.self, forKey: WireKey("primaryColor"))
        fontFamily = try container.decode(String.self, forKey: WireKey("fontFamily"))
    }

    private enum CodingKeys: String, CodingKey {
        case appearance
        case primaryColor
        case fontFamily
    }
}

public struct PresentationActivity: Codable, Equatable, Sendable {
    public let activityId: String
    public let identityAvatar: String
    public let identityName: String
    public let state: ActivityState
    public let statusText: String
    public let title: String

    public init(
        activityId: String,
        identityAvatar: String,
        identityName: String,
        state: ActivityState,
        statusText: String,
        title: String
    ) {
        self.activityId = activityId
        self.identityAvatar = identityAvatar
        self.identityName = identityName
        self.state = state
        self.statusText = statusText
        self.title = title
    }

    public init(from decoder: any Decoder) throws {
        let container = try exactContainer(
            from: decoder,
            keys: ["activityId", "identityAvatar", "identityName", "state", "statusText", "title"]
        )
        activityId = try container.decode(String.self, forKey: WireKey("activityId"))
        identityAvatar = try container.decode(String.self, forKey: WireKey("identityAvatar"))
        identityName = try container.decode(String.self, forKey: WireKey("identityName"))
        state = try container.decode(ActivityState.self, forKey: WireKey("state"))
        statusText = try container.decode(String.self, forKey: WireKey("statusText"))
        title = try container.decode(String.self, forKey: WireKey("title"))

        guard !activityId.isEmpty else {
            throw WireValidationError.invalidPayload
        }
    }

    private enum CodingKeys: String, CodingKey {
        case activityId
        case identityAvatar
        case identityName
        case state
        case statusText
        case title
    }
}

public struct PresentationPayload: Codable, Equatable, Sendable {
    public let displayId: Int64
    public let expanded: Bool
    public let reducedMotion: Bool
    public let theme: PresentationTheme
    public let primaryActivityId: String
    public let activityCount: Int
    public let activityCountText: String
    public let activities: [PresentationActivity]

    public init(
        displayId: Int64,
        expanded: Bool,
        reducedMotion: Bool,
        theme: PresentationTheme,
        primaryActivityId: String,
        activityCount: Int,
        activityCountText: String,
        activities: [PresentationActivity]
    ) {
        self.displayId = displayId
        self.expanded = expanded
        self.reducedMotion = reducedMotion
        self.theme = theme
        self.primaryActivityId = primaryActivityId
        self.activityCount = activityCount
        self.activityCountText = activityCountText
        self.activities = activities
    }

    public init(from decoder: any Decoder) throws {
        let container = try exactContainer(
            from: decoder,
            keys: [
                "displayId",
                "expanded",
                "reducedMotion",
                "theme",
                "primaryActivityId",
                "activityCount",
                "activityCountText",
                "activities"
            ]
        )
        displayId = try container.decode(Int64.self, forKey: WireKey("displayId"))
        expanded = try container.decode(Bool.self, forKey: WireKey("expanded"))
        reducedMotion = try container.decode(Bool.self, forKey: WireKey("reducedMotion"))
        theme = try container.decode(PresentationTheme.self, forKey: WireKey("theme"))
        primaryActivityId = try container.decode(String.self, forKey: WireKey("primaryActivityId"))
        activityCount = try container.decode(Int.self, forKey: WireKey("activityCount"))
        activityCountText = try container.decode(String.self, forKey: WireKey("activityCountText"))
        activities = try container.decode([PresentationActivity].self, forKey: WireKey("activities"))

        let activityIds = Set(activities.map(\.activityId))
        guard
            !primaryActivityId.isEmpty,
            !activities.isEmpty,
            activityCount > 0,
            activityCount <= conversationIslandMaximumRevision,
            activityCount >= activities.count,
            activityIds.count == activities.count,
            activityIds.contains(primaryActivityId)
        else {
            throw WireValidationError.invalidPayload
        }
    }

    private enum CodingKeys: String, CodingKey {
        case displayId
        case expanded
        case reducedMotion
        case theme
        case primaryActivityId
        case activityCount
        case activityCountText
        case activities
    }
}

public enum ParentCommand: Equatable, Sendable, Decodable {
    case present(revision: Int64, payload: PresentationPayload)
    case dismiss(revision: Int64)
    case shutdown

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: WireKey.self)

        let version: Int
        do {
            version = try container.decode(Int.self, forKey: WireKey("version"))
        } catch {
            throw WireValidationError.unsupportedVersion
        }
        guard version == conversationIslandProtocolVersion else {
            throw WireValidationError.unsupportedVersion
        }

        let type: String
        do {
            type = try container.decode(String.self, forKey: WireKey("type"))
        } catch {
            throw WireValidationError.unknownType
        }

        switch type {
        case "present":
            try requireExactKeys(container, ["version", "type", "revision", "payload"])
            let revision = try decodeRevision(from: container)
            let payload = try container.decode(PresentationPayload.self, forKey: WireKey("payload"))
            self = .present(revision: revision, payload: payload)
        case "dismiss":
            try requireExactKeys(container, ["version", "type", "revision"])
            self = .dismiss(revision: try decodeRevision(from: container))
        case "shutdown":
            try requireExactKeys(container, ["version", "type"])
            self = .shutdown
        default:
            throw WireValidationError.unknownType
        }
    }

    public static func decode(line: String) throws -> ParentCommand {
        try decode(data: Data(line.utf8))
    }

    public static func decode(data: Data) throws -> ParentCommand {
        guard String(data: data, encoding: .utf8) != nil else {
            throw ConversationIslandProtocolError(kind: .invalidUTF8)
        }

        let jsonObject: Any
        do {
            jsonObject = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        } catch {
            throw ConversationIslandProtocolError(kind: .invalidJSON)
        }

        let metadata = ProtocolErrorMetadata(jsonObject: jsonObject)
        do {
            return try JSONDecoder().decode(ParentCommand.self, from: data)
        } catch let error as WireValidationError {
            throw ConversationIslandProtocolError(
                kind: error.protocolErrorKind,
                type: metadata.type,
                revision: metadata.revision
            )
        } catch {
            throw ConversationIslandProtocolError(
                kind: .invalidPayload,
                type: metadata.type,
                revision: metadata.revision
            )
        }
    }
}

public enum HelperEvent: Equatable, Sendable, Encodable {
    case ready(pid: Int32)
    case setExpanded(revision: Int64, expanded: Bool)
    case openActivity(revision: Int64, activityId: String)
    case hidden(revision: Int64)

    public func encode(to encoder: any Encoder) throws {
        try validate()
        var container = encoder.container(keyedBy: WireKey.self)
        try container.encode(conversationIslandProtocolVersion, forKey: WireKey("version"))

        switch self {
        case let .ready(pid):
            try container.encode("ready", forKey: WireKey("type"))
            try container.encode(pid, forKey: WireKey("pid"))
        case let .setExpanded(revision, expanded):
            try container.encode("setExpanded", forKey: WireKey("type"))
            try container.encode(revision, forKey: WireKey("revision"))
            try container.encode(expanded, forKey: WireKey("expanded"))
        case let .openActivity(revision, activityId):
            try container.encode("openActivity", forKey: WireKey("type"))
            try container.encode(revision, forKey: WireKey("revision"))
            try container.encode(activityId, forKey: WireKey("activityId"))
        case let .hidden(revision):
            try container.encode("hidden", forKey: WireKey("type"))
            try container.encode(revision, forKey: WireKey("revision"))
        }
    }

    public func encodedLine() throws -> Data {
        var data = try JSONEncoder().encode(self)
        data.append(0x0a)
        return data
    }

    private func validate() throws {
        switch self {
        case let .ready(pid):
            guard pid > 0 else {
                throw ConversationIslandProtocolError(kind: .invalidPID, type: "ready")
            }
        case let .setExpanded(revision, _):
            try validateRevision(revision, type: "setExpanded")
        case let .openActivity(revision, activityId):
            try validateRevision(revision, type: "openActivity")
            guard !activityId.isEmpty else {
                throw ConversationIslandProtocolError(
                    kind: .invalidPayload,
                    type: "openActivity",
                    revision: revision
                )
            }
        case let .hidden(revision):
            try validateRevision(revision, type: "hidden")
        }
    }

    private func validateRevision(_ revision: Int64, type: String) throws {
        guard (0...conversationIslandMaximumRevision).contains(revision) else {
            throw ConversationIslandProtocolError(kind: .invalidRevision, type: type, revision: revision)
        }
    }
}

public struct ConversationIslandProtocolError: Error, Equatable, Sendable, CustomStringConvertible {
    public enum Kind: String, Equatable, Sendable {
        case invalidUTF8 = "invalid-utf8"
        case invalidJSON = "invalid-json"
        case unsupportedVersion = "unsupported-version"
        case unknownType = "unknown-type"
        case invalidRevision = "invalid-revision"
        case invalidPID = "invalid-pid"
        case invalidPayload = "invalid-payload"
    }

    public let kind: Kind
    public let type: String?
    public let revision: Int64?

    public init(kind: Kind, type: String? = nil, revision: Int64? = nil) {
        self.kind = kind
        self.type = type
        self.revision = revision
    }

    public var description: String {
        var components = ["protocol-error", "kind=\(kind.rawValue)"]
        if let type {
            components.append("type=\(type)")
        }
        if let revision {
            components.append("revision=\(revision)")
        }
        return components.joined(separator: " ")
    }
}

private enum WireValidationError: Error {
    case unsupportedVersion
    case unknownType
    case invalidRevision
    case invalidPayload

    var protocolErrorKind: ConversationIslandProtocolError.Kind {
        switch self {
        case .unsupportedVersion:
            .unsupportedVersion
        case .unknownType:
            .unknownType
        case .invalidRevision:
            .invalidRevision
        case .invalidPayload:
            .invalidPayload
        }
    }
}

private struct WireKey: CodingKey, Hashable {
    let stringValue: String
    let intValue: Int? = nil

    init(_ stringValue: String) {
        self.stringValue = stringValue
    }

    init?(stringValue: String) {
        self.init(stringValue)
    }

    init?(intValue: Int) {
        return nil
    }
}

private struct ProtocolErrorMetadata {
    let type: String?
    let revision: Int64?

    init(jsonObject: Any) {
        guard let object = jsonObject as? [String: Any] else {
            type = nil
            revision = nil
            return
        }

        type = object["type"] as? String
        if let number = object["revision"] as? NSNumber,
           String(cString: number.objCType) != "c",
           let exactRevision = Int64(exactly: number.doubleValue)
        {
            revision = exactRevision
        } else {
            revision = nil
        }
    }
}

private func exactContainer(
    from decoder: any Decoder,
    keys: Set<String>
) throws -> KeyedDecodingContainer<WireKey> {
    let container = try decoder.container(keyedBy: WireKey.self)
    try requireExactKeys(container, keys)
    return container
}

private func requireExactKeys(
    _ container: KeyedDecodingContainer<WireKey>,
    _ keys: Set<String>
) throws {
    guard Set(container.allKeys.map(\.stringValue)) == keys else {
        throw WireValidationError.invalidPayload
    }
}

private func decodeRevision(from container: KeyedDecodingContainer<WireKey>) throws -> Int64 {
    let revision: Int64
    do {
        revision = try container.decode(Int64.self, forKey: WireKey("revision"))
    } catch {
        throw WireValidationError.invalidRevision
    }

    guard (0...conversationIslandMaximumRevision).contains(revision) else {
        throw WireValidationError.invalidRevision
    }
    return revision
}
