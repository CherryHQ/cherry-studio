import Foundation

enum MobileAPIError: LocalizedError {
    case invalidBaseURL
    case unreachable
    case unauthorized
    case serverUnavailable
    case badResponse(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return "服务地址不正确"
        case .unreachable:
            return "连不上这台 Cherry，请检查 Tailscale 地址或网络状态"
        case .unauthorized:
            return "Token 不正确，请回桌面 Cherry 重新复制"
        case .serverUnavailable:
            return "桌面端 API 服务还没开启"
        case .badResponse(let message):
            return message
        }
    }
}

final class MobileAPI {
    var baseURL: String
    var token: String

    init(baseURL: String, token: String) {
        self.baseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        self.token = token.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func state(roomId: String?) async throws -> MobileState {
        var query: [URLQueryItem] = []
        if let roomId, !roomId.isEmpty {
            query.append(URLQueryItem(name: "roomId", value: roomId))
        }
        return try await request("/mobile/api/state", query: query)
    }

    func diagnostics() async throws -> MobileDiagnostics {
        try await request("/mobile/api/diagnostics")
    }

    func sendMessage(roomId: String, content: String) async throws -> MobileMessage {
        try await request(
            "/mobile/api/rooms/\(roomId)/messages",
            method: "POST",
            body: ["content": content]
        )
    }

    func createTask(title: String, content: String, workerType: String?) async throws -> CreatedTaskResponse {
        var body: [String: String] = [
            "title": title,
            "content": content
        ]
        if let workerType, !workerType.isEmpty {
            body["workerType"] = workerType
        }
        return try await request("/mobile/api/tasks", method: "POST", body: body)
    }

    private func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        query: [URLQueryItem] = [],
        body: [String: String]? = nil
    ) async throws -> T {
        let base = baseURL.hasSuffix("/") ? String(baseURL.dropLast()) : baseURL
        guard var components = URLComponents(string: base + path) else {
            throw MobileAPIError.invalidBaseURL
        }

        var items = query
        if !token.isEmpty {
            items.append(URLQueryItem(name: "token", value: token))
        }
        if !items.isEmpty {
            components.queryItems = items
        }
        guard let url = components.url else {
            throw MobileAPIError.invalidBaseURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        }
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            if error is URLError {
                throw MobileAPIError.unreachable
            }
            throw error
        }
        guard let http = response as? HTTPURLResponse else {
            throw MobileAPIError.badResponse("没有收到服务响应")
        }
        if http.statusCode == 401 {
            throw MobileAPIError.unauthorized
        }
        if http.statusCode == 404 || http.statusCode == 502 || http.statusCode == 503 {
            throw MobileAPIError.serverUnavailable
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "请求失败：\(http.statusCode)"
            throw MobileAPIError.badResponse(message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
