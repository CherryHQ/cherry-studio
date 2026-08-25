---
description: Cherry Cloud 文本请求统一进入 AiStreamManager 与 Anthropic Provider 管线的快速实施计划
sources:
  - src/main/ai/provider
  - src/main/features/apiGateway
  - src/main/services/cherryCloud
---

# Cherry Cloud 文本调用统一管线计划

**模式**：快速
**负责人**：Codex
**日期**：2026-08-25
**路由记录**：预计 700 行；默认快速计划；最终快速计划；用户覆盖：无

## 执行协议

> 用户批准后，由主执行者按「执行」顺序完成一个实现批次，不分派实现子任务，不设置阶段门禁；批次末集中验证并提交，再由一个 clean-context Reviewer 审查。快速模式不创建执行报告或最终审计报告；Review 通过后清理计划。计划外重大决策、验证无法收敛或 Reviewer 要求改变既有决策时暂停。

## 目标

- 当前：正式分支只有内部 Agent 经 Local API Gateway 命中 Cherry Cloud 特殊直通；普通聊天和翻译仍把同一 `cherryai` Provider 下的 Cloud 模型当作普通 OpenAI-compatible CherryAI 模型，Cloud 响应也绕过 `AiStreamManager`、统一用量和输出 Adapter。模型同步只接受 active free entitlement。
- 目标：普通聊天、翻译以及经 Local API Gateway 进入的 Pi/DSH/Claude Cloud 文本请求全部由 `AiStreamManager` 调用同一个 Anthropic Provider 配置，再由 `CherryCloudService.authenticatedFetch()` 在主进程附加当前 Product Session 和设备签名；同步所有 active entitlement 的文本模型。
- 完成信号：Cloud 模型解析为 Anthropic SDK 配置且不读取 Provider API Key；默认 `cherryai::qwen` 仍走原 CherryAI HMAC；内部 Agent Cloud 请求进入 `streamPrompt()` 而不直接调用 Cloud 服务；非内部 Gateway 调用仍返回 403；付费 active entitlement 被同步、inactive entitlement 被排除；Session、Gateway lease 和连接签名行为不变。

## 关键决策

1. Cloud 模型继续使用现有 `providerId === 'cherryai' && group === 'Cherry Cloud'` 作为托管标记，只把 helper 改名为 `isManagedCherryCloudModel()`；不新建 `cherry-cloud` Provider，也不增加数据库字段。
2. 在 `config.ts` 中让 Cloud builder 先于普通 CherryAI builder 命中，并明确返回 `providerId: 'anthropic'`；Provider 配置的自定义 `fetch` 只负责把标准 Fetch 请求收窄为受信 Cloud path，认证和签名仍由 `CherryCloudService` 唯一拥有。
3. Local API Gateway 保留“仅内部 Agent、仅 Anthropic Messages”现有访问规则，本次只删除通过校验后的原始响应直通；其他协议没有已确认消费者，不扩大公开 Gateway 能力。
4. Anthropic SDK 注入的 placeholder `x-api-key`、外来 `Authorization`、hop-by-hop Header、内部 Gateway Header 和浏览器 Fetch Metadata 必须在 Cloud Provider 适配器中移除；`CherryCloudService` 继续覆盖设备签名和 Bearer Token，并锁定生产/开发 Origin。
5. Cloud Provider 的本地用量凭据归因暂记为 `{ attribution: 'unknown' }`；本次不为 `cloud-session` 增加 SQLite enum、迁移或新的公共类型。
6. `syncFreeModels()` 改为 `syncEntitledModels()`，取全部 active entitlement 与 `/v1/models` 的交集；只更新已经标记为 Cherry Cloud 的现有模型，远端 ID 若被非 Cloud 模型占用则跳过并记录，不能改写其所有权。
7. 不把 Session 代际加入 Pi/DSH 连接签名，不让登录/退出操作 Gateway lease。正式分支先完成并提交，再把测试包隔离提交重新叠到正式分支顶层；正式分支生产 Origin 保持 `https://cloud.cherryai.com.cn`。

## 执行

1. `src/main/ai/provider/__tests__/config.test.ts`、新增 `src/main/ai/provider/__tests__/cherryCloud.test.ts` — 先写失败测试，覆盖 Cloud/普通 CherryAI builder 分流、无 API Key 轮转、Fetch path/body/signal 转交及敏感 Header 清理。
2. `src/main/features/apiGateway/__tests__/proxyStream.parse.test.ts` — 把当前“直接 signed fetch”测试改为契约测试：内部 Cloud 请求必须进入 `AiStreamManager.streamPrompt()`；保留非内部 403 和 Anthropic 协议限制。
3. `src/main/services/cherryCloud/__tests__/CherryCloudService.test.ts`、`src/main/ipc/handlers/__tests__/cherryCloud.test.ts` — 先将权益契约改为 active free + paid、排除 inactive，并补非 Cloud ID 冲突不被重写的测试。
4. `src/main/ai/provider/cherryCloud.ts`、`src/main/ai/provider/config.ts`、`src/main/services/cherryCloud/CherryCloudService.ts` — 实现 Anthropic Provider 配置、Fetch 适配、Origin 读取和全部 active entitlement 同步；保持 Cloud 服务现有 Session 并发与签名实现。
5. `src/main/features/apiGateway/proxyStream.ts` — 删除 Cloud 原始请求/响应直通和原地 Header sanitizer；校验通过后继续执行现有 Converter → `AiStreamManager` → Output Adapter 管线。
6. `src/shared/data/presets/cherryai.ts` 及 Pi、DSH、Claude Code、Gateway 调用点 — 机械重命名 `isCherryCloudWorkModel`，不改变 Gateway 注入、授权、lease 或连接签名语义；同步重命名 IPC 内部 service mock 和方法调用。
7. 在正式分支集中运行最窄测试、`pnpm lint` 与 `pnpm test:lint`，确认有效变更量低于 4500 行后使用 `git commit -S --signoff` 提交；重启并校验当前 workspace 的 persistent Electron 实例无主进程启动错误；完成一个 clean-context 只读 Reviewer 审查并处理允许的修复。
8. Reviewer PASS 后删除已提交计划并单独签名提交；将 `zhibisora/cherry-cloud-test-build` 的隔离提交 rebase 到新的正式分支顶层，不推送、不自动更新 PR。

## 非目标

1. 不实现绘图、图片生成或新的 modality registry。
2. 不新增 Provider、DataApi 端点、通用 Transport Registry 或 OAuth 抽象。
3. 不修改 Cloud API 后端协议、登录页面、Renderer 账号 UI、Session SQLite schema 或 safeStorage。
4. 不开放外部 Local API Gateway 消费 Cloud 套餐，不改变 Pi/DSH/Claude 的 Gateway 授权和连接生命周期。
5. 不把测试包名称、数据目录、`cherrystudiotest` 协议或 dev Origin 混入正式分支实现提交。

## 验证

- `pnpm install` — 使用仓库锁定的 Node/pnpm 并确保依赖状态可用。
- `pnpm test:main src/main/ai/provider/__tests__/config.test.ts src/main/ai/provider/__tests__/cherryCloud.test.ts src/main/features/apiGateway/__tests__/proxyStream.parse.test.ts src/main/services/cherryCloud/__tests__/CherryCloudService.test.ts src/main/ipc/handlers/__tests__/cherryCloud.test.ts src/main/ai/runtime/pi/modelInjection.test.ts src/main/ai/runtime/dsh/__tests__/modelInjection.test.ts` — Cloud Provider、Gateway、权益、生命周期和 Agent 注入契约全部通过。
- `pnpm lint` — 格式、类型、i18n 和静态检查通过，且只保留本任务产生的格式变更。
- `pnpm test:lint` — CI 等价 lint 无 warning。
- `git diff --numstat <计划提交>..HEAD` — 手写源码与测试有效变更量少于 4500 行。
- Electron persistent 实例检查 — 新 HEAD 对应的 Electron PID、workspace cwd、CDP 9222 listener 和 main-window target 均匹配；主进程日志无本次改动导致的启动错误，实例保持运行。

**预计有效变更量**：700 行
