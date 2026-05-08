import Foundation

struct MobileState: Decodable {
    var rooms: [MobileRoom]
    var workers: [MobileWorker]
    var selectedRoomId: String?
    var messages: [MobileMessage]
}

struct MobileRoom: Decodable, Identifiable, Hashable {
    var id: String
    var title: String
    var status: String
    var assignedAgentId: String?
}

struct MobileWorker: Decodable, Identifiable, Hashable {
    var key: String?
    var type: String?
    var label: String
    var healthLabel: String
    var canRun: Bool
    var workload: MobileWorkload?

    var id: String { key ?? type ?? label }
    var workerType: String { key ?? type ?? "" }
}

struct MobileWorkload: Decodable, Hashable {
    var activeRuns: Int?
    var label: String?
}

struct MobileMessage: Decodable, Identifiable, Hashable {
    var id: String
    var authorType: String
    var kind: String
    var content: String
    var createdAt: String
}

struct CreatedTaskResponse: Decodable {
    var room: MobileRoom
    var message: MobileMessage
}

struct MobileDiagnostics: Decodable {
    var build: String
    var shellBuild: String
    var label: String
    var tokenValid: Bool
    var serverTime: String
    var machineName: String
    var port: Int
    var counts: MobileDiagnosticsCounts
}

struct MobileDiagnosticsCounts: Decodable {
    var rooms: Int
    var workers: Int
}
