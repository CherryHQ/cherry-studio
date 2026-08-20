# Cherry Cloud 简单登录计划

**模式**：快速
**负责人**：Codex
**日期**：2026-08-20
**路由记录**：预计 900 行；默认快速计划；最终快速计划；用户覆盖：只修改 `/Users/sora/conductor/workspaces/cherry-studio-v1/sydney-v1` 客户端；Cloud API 仓库只读；本批只做简单登录和登录态，服务商、模型及推理请求后续处理。

## 执行协议

> 用户批准后，由主执行者按「执行」顺序完成一个实现批次，不分派实现子任务，不设置阶段门禁；批次末集中验证并提交，再由一个 clean-context Reviewer 审查。快速模式不创建执行报告或最终审计报告；Review 通过后清理计划。计划外重大决策、验证无法收敛或 Reviewer 要求改变既有决策时暂停。

## 目标

- 当前：客户端头像弹窗只有头像和用户名；客户端没有 Cherry Cloud Product Session 登录实现。协议分支定义了桌面授权创建、`cherrystudio://cloud-auth/callback` 一次性交接以及 authorization exchange。
- 目标：头像弹窗显示 Cherry Studio 登录按钮；点击后由主进程生成 state、PKCE 和设备 Ed25519 公钥，创建桌面授权并打开服务端返回的浏览器地址；专用 deeplink 回调由主进程交换 Product Session，将凭据加密保存在本机，并把不含 secret 的登录状态返回给头像弹窗。
- 完成信号：未登录显示登录按钮；等待浏览器时按钮不可重复点击；成功 callback 后显示账号名称或“已登录”；应用重启后登录态可恢复；callback secret 不会广播给 renderer；错误后可重新登录。

## 关键决策

1. 新建独立 `CherryCloudService`，不复用 CherryIN 或 `OAuthRuntimeService` — 这是 Cherry Product Session 的桌面授权，不是现有 provider OAuth。
2. API origin 读取 `CHERRY_CLOUD_API_ORIGIN`，未配置时使用 `http://127.0.0.1:8080` — 首版便于本地联调，后续替换真实地址不改流程。
3. Token、待完成授权、账号快照和设备私钥只存在主进程；持久文件使用 Electron `safeStorage` 加密，renderer IPC 只返回 `idle | authorizing | signed-in` 和可选显示名。
4. `ProtocolService` 增加 `cloud-auth` 专用路由，严格交给 `CherryCloudService`，不经过 `navigation.protocol_data` 广播。
5. 本批不实现 Token 刷新、退出或签名 API 请求；会话绝对过期时恢复为未登录，后续服务商接入时再实现刷新和调用链。

## 执行

1. `src/main/services/cherryCloud/`、`src/main/core/paths/pathRegistry.ts`、`src/main/core/application/serviceRegistry.ts` — 实现登录契约校验、state/PKCE/Ed25519 生成、授权创建/交换、`safeStorage` 加密持久化和公开状态事件，并补主进程单元测试。
2. `src/shared/ipc/schemas/cherryCloud.ts`、`src/shared/ipc/schemas/ipcSchemas.ts`、`src/main/ipc/handlers/cherryCloud.ts`、`src/main/ipc/handlers/ipcHandlers.ts` — 增加 `status`、`login` 请求和公开状态事件，不返回 Token、handoff、verifier 或私钥。
3. `src/main/services/protocol/ProtocolService.ts` 及测试 — 添加 `cherrystudio://cloud-auth/callback` 专用处理，验证错误/成功回调都不落入 renderer 广播。
4. `src/renderer/components/UserPopup.tsx`、`src/renderer/components/__tests__/UserPopup.test.tsx`、renderer locale catalogs — 新增登录按钮、授权中状态和已登录状态，监听主进程公开状态事件；保留现有头像与用户名行为。
5. 最终检查只包含客户端登录链路；删除先前服务商/模型假设的收敛账本，不修改 Cloud API 后端。

## 非目标

1. 不新增 Cherry Studio 服务商，不修改 provider registry，不预置或同步模型。
2. 不实现模型请求签名、Token 自动刷新、退出登录、账号中心、配额或权益界面。
3. 不修改现有 CherryIN OAuth/API Key 代码。
4. 不修改 Cloud API 后端；后端尚未挂载授权接口时，以 mock HTTP 和 deeplink 测试验证客户端流程。

## 验证

- `pnpm exec vitest run --silent --project main <CherryCloudService/Protocol/IPC 测试>` — 创建授权、交换、持久恢复、错误恢复与 deeplink 隔离通过。
- `pnpm exec vitest run --silent --project renderer src/renderer/components/__tests__/UserPopup.test.tsx` — 未登录、授权中、已登录和既有头像行为通过。
- `pnpm lint`、`pnpm test:lint`、`git diff --check` — 类型、i18n、格式和本分支 lint 全部通过。
- 只读检查 `/Users/sora/conductor/workspaces/cherry-studio-cloud-api/add-feishu-docs-plan-auth-flow` — 后端 worktree 零修改。

**预计有效变更量**：900 行
