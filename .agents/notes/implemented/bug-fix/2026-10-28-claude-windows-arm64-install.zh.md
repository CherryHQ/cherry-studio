# Agent Note: 在 Windows ARM64 上选择已发布的 Claude 二进制文件

Status: implemented

[English](2026-10-28-claude-windows-arm64-install.md) | 中文

## 问题

Code Mate 内置的 mise 2026.7.14 注册表缺少 Windows ARM64 覆盖配置，请求 windows-arm64/claude 而非 win32-arm64/claude.exe。修正 URL 可以解决 404，但仍依赖 GCS。官方 CLI 也发布了 ARM64 npm 平台压缩包。通过 mise 内置安装器安装其父 npm 包时，生成的 Windows shim 会使用 Node 执行 claude.exe，并报 ERR_UNKNOWN_FILE_EXTENSION。

## 决策

Windows ARM64 安装时解析官方 @anthropic-ai/claude-code-win32-arm64 包元数据，将压缩包 URL 和 SHA-512 摘要交给 mise 现有 HTTP 后端。mise 直接校验并解包 claude.exe，不需要 npm 生命周期脚本或 Node 运行时。元数据必须与请求的包及精确版本匹配，并提供有效的 SHA-512 摘要。

安装和最新版本查询遵循 npm registry 设置，包括现有的中国地区默认源。官方 registry 与 npmmirror 互相回退；显式配置的自定义源保持独占。规范配方仍为 claude，保留托管安装身份、可用性、更新和卸载。其他平台和独立固定版本的 Agent SDK 二进制文件保留现有获取路径。

## 考虑过的替代方案

- 保留修正后的 GCS URL，仍无法解决中国大陆下载可靠性问题。
- 通过内置 npm 后端安装父包会生成无法运行的 Node 启动器。改写生成的启动器会掩盖上游安装器缺陷。
- 共用 ClaudeCodeBinaryService 的 SDK 可执行文件，会将 Code Mate 的独立更新和卸载耦合到应用固定的 SDK 版本。
- 升级所有内置 mise 二进制文件会改变无关工具和平台的安装方式。
- 改写 E2E 断言或手工放置二进制文件，会保留用户安装路径中的故障。

## 影响

Code Mate 继续动态解析安装版本。与 Agent SDK 在构建时从锁文件获取摘要不同，其完整性信息来自所选 registry 的包元数据，因此该 registry 仍是信任边界。带作用域的包 URL 在 TOML 工具选项中转义 @，因为固定版本的 mise 先解析 @，再解码选项。可用的旧安装会继续使用，直到显式更新或重装。中国大陆直连下载可靠性仍需在该网络中验证。

## 验证

- 回归 — claudeArm64Install.test.ts 和 claudeNpm.test.ts 覆盖平台压缩包选择、latest 和精确版本、完整性验证、镜像失败回退、自定义源独占，以及其他平台配方不变。
- 本地 Windows ARM64 — 隔离的真实 mise 安装下载 npm 平台压缩包，生成的 shim 输出 2.1.312 (Claude Code)。故意构造的摘要不匹配压缩包被拒绝，原有全局版本选择保持不变。
