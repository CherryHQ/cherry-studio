# Agent Note: 远程工作区文件元数据查询与带版本校验的分块读取

Status: proposed

[English](2026-11-05-remote-workspace-files.md) | 中文

## Problem

当运行在桌面端的智能体在其授权工作区内生成或修改文件（包括通过 `report_artifacts` 声明的最终交付物）时，移动端用户无法可靠地查看或获取这些产物：
1. `agent.content.read` 仅能读取由 `FileManager` 管理的持久化消息附件分片（`${messageId}:${partIndex}`），无法读取工具或脚本直接写入会话工作区的文件。
2. 工作区文件在智能体多轮执行间是可变的，而历史消息附件是不可变快照。若缺少显式的文件版本元数据（`mtime` + `sha256`）及前置条件校验，移动端在断点续传或预览被修改的文件时，可能会静默拼接或展示过期的旧字节。

## Proposal

在远程访问中新增带版本绑定校验的工作区文件元数据查询与分块读取接口：

### 1. 能力声明 (`connection.hello`)
- `connection.hello` 声明 `agentFilesVersion: 1`，标识支持工作区文件读取接口。

### 2. 工作区文件元数据与分块读取 (`agent.files.get` & `agent.files.read`)
- `@cherrystudio/remote-protocol` 定义：
  - `agent.files.get`：接收 `{ sessionId, path }`，返回 `workspaceFileMetadataSchema`（`path`、`name`、`revision`、`byteLength`、`sha256`、`updatedAt`、`mediaType?`）。
  - `agent.files.read`：接收 `{ sessionId, path, expectedRevision?, offset?, length? }`（`length` 上限为 `remoteLimits.contentBytes = 24_576`），返回 `workspaceFileChunkSchema`（`revision`、`offset`、`totalBytes`、`eof`、`encoding`、`data`）。

### 3. 严格的工作区路径隔离与版本校验 (`agentQueries.ts`)
- 桌面端针对会话授权的工作区根目录解析目标路径，并通过 `fs.realpath` 校验真实路径，任何相对路径穿越（`..`）或逃逸出工作区根目录的软链接均以 `FORBIDDEN` 拒绝。
- 非普通文件（如目录）以 `INVALID_ARGUMENT` 拒绝。
- 桌面端计算 `revision = String(Math.trunc(stat.mtimeMs))`。当 `agent.files.read` 传入 `expectedRevision` 且与当前文件版本不一致时，桌面端以 `REVISION_EXPIRED` 拒绝，确保客户端安全丢弃过期的半截缓存。

## Alternatives considered

- 暴露无限制的远程文件系统浏览器：否决。远程访问授权严格限定在已授权的智能体会话及其工作区内，不允许访问宿主机任意目录。
- 复用 `agent.content.read` 传入原始文件路径：否决。`agent.content.read` 以不可变消息分片 ID 为键；将工作区文件独立为 `agent.files.*` 接口可保持不可变历史附件与可变工作区文件版本之间的清晰边界。

## Acceptance criteria

- AC1 — `connection.hello` 广播 `agentFilesVersion: 1`，且 `@cherrystudio/remote-protocol` 校验 `agent.files.get` 与 `agent.files.read` 的参数及返回值模式。 (verification: unit — remote-protocol 维护者，`contracts.test.ts`)
- AC2 — `agent.files.get` 与 `agent.files.read` 对会话工作区内的文件返回准确的元数据、SHA-256 摘要及 24 KiB base64 数据分块。 (verification: unit — remote-access 维护者，`agent.test.ts`)
- AC3 — 当 `expectedRevision` 与工作区文件当前版本不匹配时，`agent.files.read` 以 `REVISION_EXPIRED` 拒绝请求。 (verification: unit — remote-access 维护者，`agent.test.ts`)
- AC4 — 路径穿越尝试（`..`）或逃逸出会话工作区的软链接以 `FORBIDDEN` 拒绝，目录目标以 `INVALID_ARGUMENT` 拒绝。 (verification: unit — remote-access 维护者，`agent.test.ts`)

## Risks

- 路径穿越或软链接逃逸出会话工作区：防范措施：桌面端在读取元数据或字节前通过 `fs.realpath` 解析工作区根目录与目标文件路径并校验包含关系。
- 传输过程中智能体并发修改文件：防范措施：每次 `agent.files.read` 分块读取均校验 `expectedRevision`，一旦文件变动立即返回 `REVISION_EXPIRED` 中止旧传输。
