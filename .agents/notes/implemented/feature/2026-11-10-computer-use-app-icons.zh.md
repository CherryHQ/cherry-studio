# Agent Note: 通过客户端独立通道展示实际操作的应用

Status: implemented

[English](2026-11-10-computer-use-app-icons.md) | 中文

## 问题

客户端需要标识一次 Automation REPL 调用实际操作的应用。图标属于应用展示数据，不属于工具结果或会话历史。根据前台应用或 JavaScript 源码推断目标可能标错应用。

## 决策

在 Computer Use 宿主分发期间记录实际解析出的目标，不加入 guest 返回值。使用已有的每次调用 REPL cell ID 关联目标，保存在最多容纳 256 次调用的进程内缓存中。同一次调用的目标去重。渲染器读取 REPL 上下文已有的 cell ID，通过 IPC 查询应用列表，不从工具输出读取应用展示元数据。

卡片展示该调用使用过的全部应用。SWR 按稳定应用身份合并按需图标查询。独立 SDK 客户端调用 `getAppIcon({ identity })`，读取后关闭。返回渲染器前校验 PNG MIME 类型及有界 base64。应用身份缺失、图标不可用或图片加载失败时，保留带应用名称的无障碍回退图标。

不再需要 Pi 依赖补丁、Claude 结果投影修改、MCP `_meta` 或携带图标的 `ToolResult`。两个运行时沿用已有的 Automation REPL 卡片和 cell 上下文传输。

## 考虑过的替代方案

- 工具结果或会话元数据会将仅供 UI 使用的数据重复带入执行及历史契约。
- 前台状态和源码解析无法证明实际目标身份。
- 多应用 cell 只显示一个图标会隐藏其他被操作的应用。

## 影响

关联缓存是临时的。被淘汰的调用及前一次应用进程中的调用不推断图标。没有 Computer Use 目标的调用不显示应用图标。本次不持久化图标，也不修改模型可见输出。调用返回 cell 上下文后才显示图标。

SDK 生产端 PR 提供独立接口。在该 SDK 及配套原生包发布并安装前，当前已发布依赖使用带名称的回退图标。不提交本地 SDK 路径。macOS、Windows 和 Linux 均提供原生图标。Windows 读取可执行文件或 AppsFolder 图标；Linux 使用 GTK 3/GdkPixbuf 读取 desktop entry 图标，支持 SVG 和主题图标。缺少图标或原生图像库时使用带名称的回退图标。第三方外部 Computer Use MCP 服务不在此次内置 REPL 集成范围内。

## 验证

- AC1 — 真实 REPL 内核及 Computer Use 服务测试验证目标独立记录、重复操作去重，以及纯 JavaScript cell 不关联应用。
- AC2 — 渲染器测试覆盖多目标展示、跨调用复用图标读取和切换 cell 后移除旧目标；schema 校验拒绝非 PNG 图标数据。
- AC3 — 客户端图标读取不创建应用控制；上游 SDK/原生测试验证独立请求校验和图标生成。
- Electron 视觉验收仍待执行；运行时支持依赖共用 REPL 展示路径，不使用提供商专属结果补丁。

- Review 修复：Pi 投影保留原生结构化结果，MCP 卡片在成功和失败时均解包原始结果，保留实时与恢复历史中的 cell 上下文和 audience 注解。测试串联真实 Pi MCP 转换器、原生会话、实时/历史投影、工具卡片适配和 REPL 解析。
