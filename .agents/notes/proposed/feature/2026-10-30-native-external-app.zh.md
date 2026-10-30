# Agent Note: 原生文件关联探测

Status: proposed

[English](2026-10-30-native-external-app.md) | 中文

## 问题

文件打开菜单枚举固定的编辑器列表，遗漏了已安装且关联当前文件的应用。协议注册不能证明文件兼容性。

## 提议

在 `native/external-app/` 下为各平台编译 Node-API 扩展，不创建 workspace package。TypeScript 加载与策略归属 `src/main/services/externalApp/`。用户已在开发对话中批准此归属和实现方向。

macOS 使用 NSWorkspace，Windows 使用 Shell 关联处理器，Linux 使用 GIO，同时负责探测和启动。Main 调用异步 Node-API 函数，探测和启动在 JavaScript 线程之外执行。向 renderer 返回不透明应用 ID，启动前重新枚举。保留按文件查询的默认应用元数据、不同安装副本和现有目录目标。危险扩展名仅保留受控编辑器和文件管理器。探测失败时保留默认打开和定位操作，不虚构兼容性。

应用图标以 PNG 数据 URL 返回，分别使用 NSWorkspace、Windows Shell 资源或 AppsFolder 配合 WIC，以及 Linux GTK 主题查询配合 GdkPixbuf。Linux 图标解析在宿主主线程上执行，复用已加载的 GTK 3 或 GTK 4 库；链接不同 GTK 主版本可能导致 Electron 崩溃。图标读取失败仍保留应用及其打开操作。

## 考虑过的替代方案

- 扩大硬编码应用目录仍会遗漏关联，并显示不支持当前文件的应用。
- workspace package 增加独立 JavaScript 构建和导出，却没有其他消费者。
- 解析注册表命令或桌面文件的 Exec 字段会重复实现平台启动语义。

## 验收标准

- AC1 — 普通文件列出系统关联应用，按身份去重且默认应用只展示一次；同名安装副本保持独立（验证：unit and native smoke）
- AC2 — 所选应用通过平台 API 打开；失效或伪造身份不能启动任意可执行文件（验证：unit and native smoke）
- AC3 — 危险文件保留受控编辑器限制，目录目标维持现有行为（验证：unit）
- AC4 — 本机开发和目标平台打包构建并定位正确的扩展，包含资源解包（验证：scripts and packaged artifact）
- AC5 — macOS、Windows、Linux 枚举真实关联，并通过所选处理器成功打开测试文件（验证：platform native smoke and Electron）
- AC6 — 应用图像完整通过原生与 IPC 边界；Windows 资源索引与 Linux 主题或绝对路径图标正确解析，缺失图标仍保留处理器（验证：platform icon smoke and Electron menu）

## 风险

系统注册描述的是声明的支持，而非解析正确性。Linux 枚举遵循当前桌面的 XDG 注册和可见性规则。构建主机需要平台 SDK；Linux 发布产物在 Ubuntu 22.04 容器中构建，异架构使用 QEMU。原生崩溃会影响宿主进程。原生启动成功不证明目标应用已渲染文档。在平台和打包验收完成前保持 proposed 状态。
