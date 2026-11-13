# Agent Note: 经网关保留 Claude Code 客户端身份

Status: implemented

[English](2026-11-12-gateway-client-identity.md) | 中文

## 问题

受管 Claude Code 模型从直连提供商改为经回环网关访问。SDK 重建请求时丢失 CLI 身份请求头，导致只接纳 Claude Code 客户端的中转服务可能以 403 拒绝原本有效的轮次。报告中的中转服务身份未知；本地夹具无法证明它会接受请求。

## 决策

仅当请求经内部认证、输入为 Anthropic 协议、实际使用的传输采用 Anthropic Messages 协议，且携带宿主签发的 `claude-code` 运行时能力令牌（与会话 ID 绑定，并同时校验不受限内部凭据） 时，保留 `user-agent`、`x-app` 和 `x-client-app`。共享内部密钥和会话 ID 请求头本身无法区分 Pi 与 Claude Code。ai 层的 `src/main/ai/agentSession/agentRuntimeCapability.ts` 注册表在进程生命周期内为每个会话 ID 保留一个不可猜测的令牌，并在网关停止时清空。解析时要求会话存在、处于打开状态且未在关闭中，并且当前使用 Claude Code 运行时。停放和再次访问复用同一令牌与预热查询环境。关闭流程同时阻止监听器启动和令牌签发。主进程调用方受信任：这是持有者令牌，不提供恶意主进程代码之间的隔离。模块位置遵循[主进程架构 §3](../../../../docs/dev/references/architecture/main-process.md)：features 可以依赖 ai，反向依赖禁止。Claude Code 运行时辅助函数附加该令牌；Pi 仅收到共享凭据和用量请求头。

跳过缺失或空值、Connection 指定的请求头，以及包含所呈交凭据或运行时能力令牌的值。提供商 `extraHeaders` 按不区分大小写、最后一项优先的规则归一化，仅非空的有效值阻止转发。Bedrock/Vertex 构建器不会将这些覆盖值传入提供商设置。两种响应模式都通过流请求选项传递筛选后的身份；提供商执行层继续负责凭据和传输合并。

## 考虑过的替代方案

- 恢复直连路由：绕过已确定的受管模型网关决策。
- 仅信任内部密钥或会话 ID 请求头：Pi 共用内部辅助机制，可能转发伪造身份。
- 转发任意调用方请求头或改变传输优先级：泄露内部上下文，或覆盖已配置的中转身份。
- 在自定义 fetch 中强制精确的 User-Agent：为特定中转服务的假设绕过 SDK 契约。

## 影响

提供商和模型路由保持不变。公开调用方、缺少有效 Claude Code 能力令牌的请求、OpenAI 输入和非 Anthropic 传输均不转发 CLI 身份。Cherry 内部请求头被排除。包含所呈交凭据（包括受限凭据）或运行时能力令牌的值会被拒绝。开发者模式的 HTTP 跟踪按请求头名称脱敏，不按值脱敏；此保护控制上游传输，不控制日志。传输探测使用服务请求的配置分派和 SDK 工厂以及占位凭据，不发起网络 I/O，也不轮换凭据。声明支持 Anthropic Messages 但实际使用其他传输（包括 Ollama）时不转发任何身份：标准 Anthropic、NewAPI、AiHubMix、DMXAPI 和 CherryIN 仅在构造的模型采用 Anthropic Messages 时放行。未知适配器、缺失端点配置以及构造其他协议模型的预设均拒绝转发。SDK 会在 User-Agent 后追加 provider-utils/Node 运行时后缀；验证保证前缀保留，不保证字节完全一致。其他身份值在去除首尾空白后原样保留。

## 验证

- Regression — `src/main/features/apiGateway/__tests__/clientIdentity.test.ts`：选择策略、提供商优先级、逐跳请求头排除和凭据值保护。
- Regression — `src/main/features/apiGateway/__tests__/anthropicAgent.integration.test.ts`：修复前，强制校验的中转夹具拒绝缺失 CLI 身份的请求；修复后，两种响应模式均完成工具回放，并保留上游认证和提供商 User-Agent 优先级。
- Regression — `src/main/features/apiGateway/routes/__tests__/routes.integration.test.ts`：真实不受限内部凭据与会话绑定的 Claude 能力令牌在两种认证路径下均允许身份转发；Pi 凭据加 Pi 自己的会话 ID、受限凭据、缺失/伪造/非活动令牌、会话不匹配及公开调用方均不转发。

- Regression — `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`：关闭后重开和重新分配为 Pi 均检查当前存活状态；重新签发返回同一令牌。路由测试验证停放和再次访问的预热查询哈希输入稳定、生产环境的秘密值保护接线、监听器启动失败和关闭竞态。网关路由测试调用真实 closeSession 和网关停止；适配器测试验证两种响应模式均保留中继的 403 状态和消息，且普通聊天不携带 CLI 身份。
