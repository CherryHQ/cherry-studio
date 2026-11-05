# Agent Note: 远程桌面个人资料元数据同步

Status: proposed

[English](2026-11-05-remote-desktop-profile.md) | 中文

## Problem

通过远程访问从移动端连接桌面端 Cherry Studio 时，用户无法通过桌面端配置的个人资料区分多台已配对电脑：
1. 扫码配对时，移动端仅在 `desktop_connection.name` 中记录桌面端机器主机名（`os.hostname()`）。
2. 桌面端在本地偏好设置（`app.user.name` 与 `app.user.avatar`）中保存了用户配置的昵称与头像，但 `connection.authenticate`、`connection.refresh` 与 `pairing.get` 并未向已认证的移动端暴露该元数据。
3. 当用户在桌面端修改昵称或头像，或配对了多台主机名相近的工作站时，移动端始终显示配对时的静态主机名与默认占位图标。

## Proposal

在已认证的远程访问握手与配对审批响应中下发可选的桌面端个人资料元数据：

### 1. 能力声明 (`connection.hello`)
- `connection.hello` 声明 `desktopProfileVersion: 1`，供移动端识别个人资料同步能力。

### 2. 已认证个人资料载荷 (`desktopProfileSchema`)
- `@cherrystudio/remote-protocol` 定义 `desktopProfileSchema`，包含可选的 `name`（去首尾空白的 Unicode 字符串，1–256 字符）与可选的 `avatar`（最长 65,536 字符，支持 Emoji 或紧凑 `data:image/...;base64,...` 缩略图）。
- `connection.authenticate`、`connection.refresh` 以及审批通过的 `pairing.get` 响应包含可选的 `desktopProfile`。未认证的 `connection.hello` 及待审批/已拒绝的配对轮询不包含该信息，防止向局域网未授权扫描者泄露用户身份。

### 3. 桌面端资料解析 (`RemoteConnection.ts`)
- 桌面端从 `PreferenceService` 读取 `app.user.name` 与 `app.user.avatar`。
- 当 `app.user.avatar` 指向内部文件存储（`file:<id>`）时，桌面端通过 `FileManager` 解析物理路径，并将符合 64 KiB 传输预算的图片编码为 base64 Data URI；体积超限或文件缺失时静默忽略头像字段，不影响认证流程。

## Alternatives considered

- 将头像直接编码进配对二维码：否决。二维码容量极小，无法容纳图片 Data URI，且静态二维码无法同步后续在桌面端修改的资料。
- 在未认证的 `connection.hello` 中返回个人资料：否决。局域网内任何能访问该端口的设备都可在未认证前抓取桌面端用户名与头像。
- 新增独立的个人资料查询 RPC 接口：否决。随 `connection.authenticate`、`connection.refresh` 与 `pairing.get` 捎带下发可在建连时原子同步，零额外网络往返。

## Acceptance criteria

- AC1 — `connection.hello` 广播 `desktopProfileVersion: 1`，且 `@cherrystudio/remote-protocol` 在 `connection.authenticate`、`connection.refresh` 与 `pairing.get` 上校验 `desktopProfileSchema` 边界。 (verification: unit — remote-protocol 维护者，`contracts.test.ts`)
- AC2 — 审批通过的 `pairing.get` 及已认证的 `connection.authenticate` / `connection.refresh` 响应包含桌面端配置的 `name` 与 `avatar`，且不向未认证调用方暴露资料。 (verification: unit — remote-access 维护者，`pairing.test.ts`)
- AC3 — 缺失或超限的头像文件可优雅降级为省略 `avatar` 字段，同时保持认证与 `name` 正常下发。 (verification: unit — remote-access 维护者，`pairing.test.ts`)

## Risks

- 自定义头像文件过大超出 64 KiB JSON-RPC 帧上限：防范措施：桌面端在编码前检查文件字节长度，超出预算时省略头像字段。
- 移动端在多台电脑间切换时发生资料串用：防范措施：个人资料元数据严格绑定至各自的认证会话并按 `connectionId` 独立持久化。
