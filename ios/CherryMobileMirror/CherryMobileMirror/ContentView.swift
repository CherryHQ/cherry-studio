import SwiftUI
import UIKit
import WebKit

struct ContentView: View {
    private let webBuild = "mobile-shell-20260508-7"
    private let bundledConfigVersion = "mobile-config-20260508-2"
    private let bundledBaseURL = "http://10.10.10.136:23333"
    private let bundledToken = "cs-sk-94e9f5d5-7995-4964-93af-1fa5edcf759a"

    @AppStorage("cherry.baseURL") private var baseURL = "http://10.10.10.136:23333"
    @AppStorage("cherry.token") private var token = "cs-sk-94e9f5d5-7995-4964-93af-1fa5edcf759a"
    @AppStorage("cherry.configVersion") private var configVersion = ""

    @State private var showConfigEditor = false
    @State private var isTesting = false
    @State private var testMessage: String?
    @State private var webErrorMessage: String?
    @State private var webReloadToken = UUID().uuidString
    @State private var lastLoadedAt: Date?

    private var hasConfig: Bool {
        !baseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var hasValidConfig: Bool {
        hasConfig && normalizedBaseURL != nil
    }

    private var mobileWebURL: URL? {
        guard let normalized = normalizedBaseURL else { return nil }
        guard var components = URLComponents(string: "\(normalized)/mobile") else { return nil }
        components.queryItems = [
            URLQueryItem(name: "token", value: token),
            URLQueryItem(name: "client", value: "ios"),
            URLQueryItem(name: "v", value: webBuild),
            URLQueryItem(name: "t", value: webReloadToken)
        ]
        return components.url
    }

    private var normalizedBaseURL: String? {
        normalizeInput(baseURL)
    }

    var body: some View {
        Group {
            if let message = webErrorMessage, hasValidConfig {
                WebErrorView(
                    message: message,
                    onRetry: reloadMobilePage,
                    onOpenSettings: { showConfigEditor = true }
                )
            } else if hasValidConfig, let url = mobileWebURL {
                MobileWebPanelView(
                    url: url,
                    onError: { message in webErrorMessage = message },
                    onLoaded: {
                        webErrorMessage = nil
                        lastLoadedAt = Date()
                    }
                )
                .ignoresSafeArea(.container, edges: [.top, .bottom])
                .ignoresSafeArea(.keyboard, edges: .bottom)
            } else {
                ConfigHintView(
                    baseURL: baseURL,
                    message: testMessage ?? validationMessage(for: baseURL),
                    onOpenSettings: { showConfigEditor = true }
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color(red: 0.067, green: 0.071, blue: 0.078))
        .ignoresSafeArea(.container, edges: [.top, .bottom])
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .onAppear {
            syncBundledDefaultsIfNeeded()
            if !hasValidConfig {
                showConfigEditor = true
            }
        }
        .sheet(isPresented: $showConfigEditor) {
            ConnectionConfigSheet(
                baseURL: baseURL,
                token: token,
                isTesting: $isTesting,
                testMessage: $testMessage,
                onSave: { url, t in
                    guard let normalized = normalizeInput(url), !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                        testMessage = validationMessage(for: url) ?? "请先填写服务地址和 token"
                        return false
                    }
                    baseURL = normalized
                    token = t.trimmingCharacters(in: .whitespacesAndNewlines)
                    webErrorMessage = nil
                    webReloadToken = UUID().uuidString
                    showConfigEditor = false
                    return true
                },
                currentLoadURL: mobileWebURL?.absoluteString ?? "未生成",
                bundleID: Bundle.main.bundleIdentifier ?? "unknown",
                shellBuild: webBuild,
                cacheMode: "非持久 WebView，每次打开不读旧缓存",
                lastLoadedAt: lastLoadedText,
                onTest: { url, t in
                    await testConnection(url: url, token: t)
                }
            )
        }
    }

    private func validationMessage(for raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        var normalized = trimmed
        if normalized.hasSuffix("/mobile") {
            normalized = String(normalized.dropLast(7))
        } else if normalized.hasSuffix("/mobile/") {
            normalized = String(normalized.dropLast(8))
        }
        while normalized.hasSuffix("/") {
            normalized.removeLast()
        }

        if !normalized.lowercased().hasPrefix("http://") && !normalized.lowercased().hasPrefix("https://") {
            normalized = "http://\(normalized)"
        }

        guard let components = URLComponents(string: normalized), let host = components.host else {
            return "服务地址格式不对，请填 Mac 的地址和端口"
        }
        if isLoopbackHost(host) {
            return "手机不能用 127.0.0.1，请填 Mac 的局域网 IP 或 Tailscale 地址"
        }
        return nil
    }

    private func syncBundledDefaultsIfNeeded() {
        if configVersion == bundledConfigVersion { return }

        baseURL = bundledBaseURL
        token = bundledToken
        configVersion = bundledConfigVersion
        webErrorMessage = nil
        webReloadToken = UUID().uuidString
    }

    private func testConnection(url: String, token: String) async {
        let normalized = normalizeInput(url)
        guard let normalized, !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            testMessage = validationMessage(for: url) ?? "请先填写服务地址和 token"
            return
        }

        do {
            let diagnostics = try await MobileAPI(baseURL: normalized, token: token).diagnostics()
            testMessage = "连接成功：\(diagnostics.build)，房间 \(diagnostics.counts.rooms)，Worker \(diagnostics.counts.workers)"
        } catch {
            testMessage = error.localizedDescription
        }
    }

    private var lastLoadedText: String {
        guard let lastLoadedAt else { return "还没有成功加载" }
        return lastLoadedAt.formatted(date: .omitted, time: .standard)
    }

    private func reloadMobilePage() {
        webErrorMessage = nil
        webReloadToken = UUID().uuidString
    }

    private func normalizeInput(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        var normalized = trimmed
        if normalized.hasSuffix("/mobile") {
            normalized = String(normalized.dropLast(7))
        } else if normalized.hasSuffix("/mobile/") {
            normalized = String(normalized.dropLast(8))
        }
        while normalized.hasSuffix("/") {
            normalized.removeLast()
        }

        if !normalized.lowercased().hasPrefix("http://") && !normalized.lowercased().hasPrefix("https://") {
            normalized = "http://\(normalized)"
        }

        if let components = URLComponents(string: normalized), let host = components.host, !isLoopbackHost(host) {
            return normalized
        }
        return nil
    }

    private func isLoopbackHost(_ host: String) -> Bool {
        let lower = host.lowercased()
        return lower == "localhost" || lower == "127.0.0.1" || lower == "::1" || lower.hasPrefix("127.")
    }

}

struct MobileWebPanelView: View {
    let url: URL
    let onError: (String) -> Void
    let onLoaded: () -> Void

    var body: some View {
        CherryMobileWebView(url: url, onError: onError, onLoad: onLoaded)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(red: 0.067, green: 0.071, blue: 0.078))
            .ignoresSafeArea(.container, edges: [.top, .bottom])
    }
}

struct CherryMobileWebView: UIViewRepresentable {
    let url: URL
    let onError: (String) -> Void
    let onLoad: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onError: onError, onLoad: onLoad)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.bounces = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.contentInset = .zero
        webView.scrollView.scrollIndicatorInsets = .zero
        webView.scrollView.automaticallyAdjustsScrollIndicatorInsets = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.067, green: 0.071, blue: 0.078, alpha: 1)
        webView.load(makeNoCacheRequest(url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        if uiView.url?.absoluteString != url.absoluteString {
            uiView.load(makeNoCacheRequest(url))
        }
    }

    private func makeNoCacheRequest(_ url: URL) -> URLRequest {
        var request = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
            timeoutInterval: 20
        )
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.setValue("no-cache", forHTTPHeaderField: "Pragma")
        return request
    }

    class Coordinator: NSObject, WKNavigationDelegate {
        let onError: (String) -> Void
        let onLoad: () -> Void

        init(onError: @escaping (String) -> Void, onLoad: @escaping () -> Void) {
            self.onError = onError
            self.onLoad = onLoad
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async {
                self.onLoad()
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            show(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            show(error)
        }

        private func show(_ error: Error) {
            DispatchQueue.main.async {
                self.onError("页面加载失败：\(error.localizedDescription)")
            }
        }
    }
}

private struct WebErrorView: View {
    let message: String
    let onRetry: () -> Void
    let onOpenSettings: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 42))
                .foregroundStyle(.secondary)
            Text("没有连上 Cherry")
                .font(.headline)
                .foregroundStyle(.primary)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            HStack(spacing: 12) {
                Button("设置", action: onOpenSettings)
                    .buttonStyle(.bordered)
                Button("重新加载", action: onRetry)
                    .buttonStyle(.borderedProminent)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}

private struct ConfigHintView: View {
    let baseURL: String
    let message: String?
    let onOpenSettings: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Spacer()
            VStack(spacing: 10) {
                Image(systemName: "iphone.gen1")
                    .font(.system(size: 52))
                    .foregroundStyle(.secondary)
                Text("先配置手机连接")
                    .font(.headline)
                Text("填写 Cherry 服务地址和 Token 后即可进入任务台。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                if let message {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                if !baseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("已保存地址：\(baseURL)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Button("连接设置", action: onOpenSettings)
                    .buttonStyle(.borderedProminent)
            }
            .padding(.horizontal, 24)
            Spacer()
        }
    }
}

private struct ConnectionConfigSheet: View {
    @Environment(\.dismiss) private var dismiss

    @State private var draftBaseURL: String
    @State private var draftToken: String
    private let onSave: (String, String) -> Bool
    private let currentLoadURL: String
    private let bundleID: String
    private let shellBuild: String
    private let cacheMode: String
    private let lastLoadedAt: String
    @Binding private var isTesting: Bool
    @Binding private var testMessage: String?
    let onTest: (String, String) async -> Void

    init(
        baseURL: String,
        token: String,
        isTesting: Binding<Bool>,
        testMessage: Binding<String?>,
        onSave: @escaping (String, String) -> Bool,
        currentLoadURL: String,
        bundleID: String,
        shellBuild: String,
        cacheMode: String,
        lastLoadedAt: String,
        onTest: @escaping (String, String) async -> Void
    ) {
        _draftBaseURL = State(initialValue: baseURL)
        _draftToken = State(initialValue: token)
        _isTesting = isTesting
        _testMessage = testMessage
        self.onSave = onSave
        self.currentLoadURL = currentLoadURL
        self.bundleID = bundleID
        self.shellBuild = shellBuild
        self.cacheMode = cacheMode
        self.lastLoadedAt = lastLoadedAt
        self.onTest = onTest
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("服务地址（含端口）") {
                    TextField("例如: http://192.168.1.10:23333", text: $draftBaseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                }
                Section("Token") {
                    SecureField("cs-sk-...", text: $draftToken)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                if let testMessage {
                    Section {
                        Text(testMessage)
                            .foregroundStyle(testMessage.hasPrefix("连接成功") ? .green : .red)
                    }
                }
                Section("当前诊断") {
                    LabeledContent("壳版本", value: shellBuild)
                    LabeledContent("Bundle ID", value: bundleID)
                    LabeledContent("缓存模式", value: cacheMode)
                    LabeledContent("最近加载", value: lastLoadedAt)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("完整加载地址")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(currentLoadURL)
                            .font(.caption2)
                            .textSelection(.enabled)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("连接设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .destructiveAction) {
                    Button("清除") {
                        draftBaseURL = ""
                        draftToken = ""
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    HStack {
                        Button("测试") {
                            Task {
                                isTesting = true
                                testMessage = nil
                                await onTest(draftBaseURL, draftToken)
                                isTesting = false
                            }
                        }
                        .disabled(isTesting)

                        if isTesting {
                            ProgressView()
                                .scaleEffect(0.75)
                        }

                        Button("保存") {
                            if onSave(draftBaseURL, draftToken) {
                                dismiss()
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(draftBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draftToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
