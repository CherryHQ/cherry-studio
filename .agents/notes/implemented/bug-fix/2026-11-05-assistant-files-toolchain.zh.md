# Agent Note: 让内置助手的文件工具在对话中真正可用

Status: implemented

[English](2026-11-05-assistant-files-toolchain.md) | 中文

## 问题

内置 Assistant 的 `assistant-files` 服务存在三条死路。`move_to_trash` 在记录的 30 次调用中全部失败：macOS 上 `getProtectedTrashTargetReason` 把整个 `~/Library` 当作应用数据，导致存放在 `~/Library/Application Support/CherryStudio-Shared-Workspaces` 下的用户工作区文件全部被拒绝。`save_attachment` 在记录的 13 次调用中全部失败：它只按哈希后的 `file_<digest>` handle 匹配，而对话里显示的是原始文件名，模型只能传它看得见的名字。两个工具随后又把真实原因替换成 `Tool execution failed`，模型无法区分「路径受保护」「handle 错误」和「父目录不存在」。

## 决定

macOS 不再 blanket 保护整个 `~/Library`。受保护的应用数据容器改为敏感的 Library 子目录（Keychains、LaunchAgents、LaunchDaemons、Preferences、Cookies、Accounts、Safari、Mail、Messages、Mobile Documents、CloudStorage），加上 Cherry Studio 自己的 `Library/Application Support/CherryStudio`；非标准安装路径继续由 `app.userdata` 上下文覆盖。因此 `Application Support` 下的工作区被放行，而 `~/.ssh`、`~/Library/Keychains`、Cherry Studio 数据、工作区根目录与版本控制元数据仍然拒绝。

`save_attachment` 先按 handle 解析，再按唯一的 `displayName` 解析。重名时直接失败并列出候选 handle，因为猜错会复制错附件。

`AssistantFileToolsServer.runTool` 返回脱敏后的 `error.message`（去掉控制字符，上限 500 字符），不再返回 `Tool execution failed`，模型因此能区分受保护路径、错误 handle、缺失父目录与读取失败。

## 备选方案

- 放行传入工作区的所有严格子路径：如果工作区就根在应用数据目录，`cherrystudio.sqlite` 也会被允许移入回收站。收窄 `~/Library` 可以保持 Cherry Studio 数据受保护，且与工作区根在哪无关。
- 在对话里注入 `file_<digest>` handle：handle 是内部派生值，对话本身已经显示文件名；让工具认识可见名字是更小的改动，且仍能检测歧义。
- 继续吞掉失败原因：审计表明模型没有原因就无法自我纠正。这里只剥离控制字符并限制长度，而且工具消息本来就不含 entry id 或临时拷贝路径。

## 后果

- `~/Library/Application Support` 下其他应用的数据不再被这条守卫 blanket 保护。工具只能触达工作区包含的路径，所以暴露面仅限于根在该目录树内的工作区。
- 重名附件现在必须使用 handle；错误会列出候选。
- 失败文案可能包含用户传入的路径与工具自身的原因，但不会包含附件 entry id 或临时拷贝路径；`save_attachment` 仍会把文件系统失败替换为基于路径的消息。
- Windows 上位于 `AppData` 下的用户工作区仍然拒绝；本次只收窄 macOS 的容器。

## 验证

- 回归 — `pnpm test:main src/main/ai/tools/__tests__/moveToTrash.test.ts`：审计中的 `~/Library/Application Support/CherryStudio-Shared-Workspaces` 工作区可以把文件移入回收站，而工作区根、`~/.ssh`、`~/Library/Keychains` 与 Cherry Studio 数据仍被拒绝。
- 回归 — `pnpm test:main src/main/ai/tools/__tests__/saveAttachment.test.ts`：唯一显示名可以复制文件；重名时要求使用 handle 并列出两者。
- 回归 — `pnpm test:main src/main/ai/mcp/servers/__tests__/AssistantFileToolsServer.test.ts`：被拒绝的移入回收站与缺失附件会返回具体原因，而不是 `Tool execution failed`。
- 回归 — `pnpm typecheck:node`：主进程类型检查通过。
