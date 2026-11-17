# Agent Note：Claude Code 运行时缺失或启动失败时快速失败并给出可操作提示

Status: implemented

[English](2026-11-10-claude-runtime-missing-spawn-failure.md) | 中文

## 问题

在打包版 Windows 构建中，Agent（工作对话）在首个模型请求之前即中断，错误为 `ClaudeCodeProcessExitError: Claude Code process failed to start`。主进程日志显示 SDK 无法解析其原生可执行文件（`ReferenceError: Claude Code native binary not found at ... app.asar.unpacked ... (code: ENOENT)`），或已存在二进制文件的启动失败（`spawnFailed: true`）。用户侧只看到笼统的未知错误：解析出的路径与 `ENOENT` 原因从未到达 UI，也没有应用内重新准备运行时的方式。重试同样失败，且 `%TEMP%` 下的临时解包镜像路径可能在其指向的目录消失后仍被使用（见 #21898）。

## 决策

在按需运行时可执行文件未安装时，于 SDK 启动前失败，并对缺失运行时与启动失败两类退出提供渲染器侧恢复文案：

- `ClaudeCodeBinaryService.requireExecutable()` 抛出携带 `claude_code_runtime_missing` / `claude_code_runtime_unsupported` 键的 `ClaudeCodeRuntimeUnavailableError`。解析出的 userData 路径、target、版本与阶段仅记录在主进程日志中，路径绝不跨 IPC。
- 解析到 `app.asar` 内部的路径会被直接拒绝，过期或临时的应用镜像绝不会被用于启动运行时。
- `ClaudeCodeProcessManager.spawn()` 在诊断信息中记录尝试的可执行文件与启动 `code`；`recordClaudeCodeSpawnError` 将完整原因保留在 `terminalReason`（仅主进程）。日志保持结构化——`terminalReason`/stderr 绝不进入日志行或渲染器载荷。
- `spawnFailed` 退出经 `createClaudeCodeProcessExitError` 附加 `claude_code_spawn_failed` 键；`ErrorBlock` 在描述中保留诊断参考号，在标题/详情中渲染检查杀毒软件隔离与权限后重发的指引（不承诺输入框重试——`ready` 状态下没有重试控件）。
- `src/main/ipc/handlers/ai.ts` 中的 `exposeAiStreamAdmission` 将准入阶段携带 `i18nKey` 的错误以 `AI_REQUEST_FAILED` 加完整 `serializeError` 载荷包装，使恢复字段穿过 IPC；`src/renderer/services/toast.ts` 中的 `toast.errorFromException` 优先使用这些应用自有文案（`claude_code_*` 即便带有模型 provider 也优先），准入 toast 显示本地化标题与恢复详情，而非旧文案。

## 考虑过的替代方案

- 在轮次内自动下载缺失的可执行文件——不采用，因为获取已属于输入框门控的 `ensure` 流程（含共享进度/重试）；轮次必须快速失败，而非再起一次隐式安装。
- 仅修改笼统的 SDK 错误文本——不采用，因为 Cherry 可以在启动前/启动时精确识别缺失的解包产物与启动 `code`。
- 记录原始 `terminalReason`/stderr 或将解析路径转发给渲染器——不采用，因为 stderr 与错误信息可能包含密钥与私有路径；现有隐私测试禁止它们出现在日志与渲染器载荷中。

## 后果

运行时缺失时，每次显式请求都会在不启动 SDK 的情况下失败一次，因此重复轮次不会产生重复的失败子进程。已存在二进制文件的启动失败保留诊断参考号用于日志关联，同时 UI 会指明运行时并指向检查杀毒软件隔离与权限后重发，而非未知错误。运行时路径为稳定的 userData，绝非常应用镜像。准入阶段获取失败时，toast 同样显示本地化恢复文案，而非旧文案。

## 验证

- 回归——`pnpm exec vitest run --project main src/main/ai/runtime/claudeCode/__tests__/claudeRuntimeUnavailable.test.ts src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeBinaryService.test.ts src/main/ai/runtime/claudeCode/__tests__/processExitDiagnostics.test.ts`：类型化缺失/不支持错误、`app.asar` 拒绝、稳定的 userData 路径、启动 `code`/可执行文件记录且不泄露到渲染器。
- 渲染器——`pnpm exec vitest run --project renderer src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx src/renderer/utils/__tests__/errorClassifier.test.ts`：运行时缺失与启动失败文案正常显示且不触发 AI 诊断；参考号保留。
- 渲染器 toast——`pnpm exec vitest run --project renderer src/renderer/services/__tests__/toast.test.ts`：准入阶段 `AI_REQUEST_FAILED` 携带 `claude_code_runtime_missing` 时显示本地化标题与恢复详情（含模型 provider 的情况）。
- 传输——`pnpm exec vitest run --project main src/main/ipc/handlers/__tests__/ai.test.ts`：准入阶段运行时错误经 `ai.stream.open` 保留 `i18nKey`/`detailI18nKey`。
- `pnpm i18n:check`：通过。
- 未在此沙盒中运行打包版 Windows 验证。
