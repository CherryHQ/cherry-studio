# Agent Note: LM Studio 的 Pi Work 本地图片输入

Status: implemented

[English](2026-10-19-pi-work-local-image-input.md) | 中文

## Problem

Work（`agent-session`）请求在 `src/main/ai/AiService.ts` 提前分流，绕过普通 Chat 的附件物化。Pi driver 把本地附件压成文件名和绝对路径文本。因此，LM Studio Work 回合中的本地图片从未进入模型输入：本地假上游抓包捕获到零张图片。读不到的附件也不报错。

## Decision

- 行为严格限定为 `matchesPreset(provider, SystemProviderIds.lmstudio)`，且实际 endpoint 为 `openai-completions`、adapter 为 `openai-compatible`、模型通过 `MODEL_CAPABILITY.IMAGE_RECOGNITION` 或 `inputModalities` 含 `image` 声明图片输入。其他提供商（包括任意 OpenAI-compatible 提供商或 localhost 指向）、非图片附件和纯文本输入均保留原行为。
- `src/main/ai/runtime/pi/piUserContent.ts` 复用 `materializeNativeFilePart`。成功内联的图片从传给文本 builder 的临时副本中移除，并作为 Pi 原生图片入参传给 `session.prompt(text, { images, streamingBehavior })`。
- 准备过程对整批图片保持原子性。任一图片读取失败、内容为空或图片处理失败，均以 `PiImagePreparationError` 拒绝本次提交，携带 `i18nKey`、具名 `detailI18nKey` 和原文件名。不发送 completion 请求，也不发送部分图片。
- 目标路由中，含本地图片的 steer 提交由 `redirect()` 返回 `false`，交给既有 host fallback 排到下一轮，不新增异步 steer 状态机。
- 目标路由通过 Pi 的 `onPayload` 复用 `transformLmStudioRequestBody`：多图使用裸 base64，单图保留 data URL。

## Alternatives considered

- 只在 `lmstudio.ts` 的 request transform 中内联 `file://`：transform 看不到已被压成文本的附件，无法补回图片，也拿不到附件名来生成具名错误。
- 为所有 OpenAI-compatible 提供商开启准备：这会同时改变云端提供商的图片链路，超出范围。
- 不检查模型图片能力：非视觉模型会收到 image block，可能被端点拒绝，比现有的路径文本行为更差。
- 图片 steer 异步准备后即时 steer：需要围绕 `redirect()` 的同步布尔契约引入新的时序与取消协议，超出本轮修复。
- 坏附件降级为模型可见 note：Issue 的验收要求是本地、具名、可操作的错误。

## Consequences

目标路由的本地图片现在自动进入模型输入。准备失败会拒绝本次提交，这是声明范围内有意引入的行为变化。中途提交的图片移至下一轮。Pi 仍会二次处理图片；预检用于防止静默丢图，并不替代 Pi 的处理。

普通 Chat 的 nullable 物化降级、附件存储和上传、非图片编码、共享 `agentUserContent` 行为、Claude Code driver、retired history 导入及云端提供商均保持不变。

## Verification

以下产品验证记录对应提交 `1a05c6da3fd62ce98a42af8e7cb7da8695a6354e`；本次仅补文档，不重新执行这些检查。

- Regression — `pnpm exec vitest run --project main` 显式筛选 `piUserContent`、`PiRuntimeConnection`、`modelInjection`、`lmstudio`、`fileProcessor`、`attachmentRouting`、`agentUserContent` 和 `serializeError`：八个文件共 271 项测试通过，覆盖图片准备、路由选择、wire 转换及受影响的消费者。
- Regression — `pnpm test:renderer src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx`：18 项测试通过，包括具名图片准备错误的渲染。
- Regression — `pnpm i18n:check`、node/web/e2e typecheck 及 oxlint/oxfmt 检查均 exit 0。
- Regression — 真实 `PiRuntimeConnection.send` 搭配真实 `node:http` 假上游：双图和九图 payload 逐字节匹配；缺失文件与空文件均产生零请求和具名错误。
- Regression — 真实 Electron smoke `tests/e2e/smoke/agentLocalImageTurn.test.ts`：两条用例均通过，包含成功回合回归和错误卡截图。

未验证：真实 LM Studio 版本对多图裸 base64 的接受度、Windows 路径行为，以及用户原始 400 响应的来源。
