# Agent Note: 保留经过内部网关的智能体请求选择

Status: implemented

[English](2026-11-07-agent-gateway-request-controls.md) | 中文

## 问题

智能体轮次会捕获推理强度、服务档位和 Fast 选择，但桌面桥接对它们的解释不同。Claude 遗漏服务档位，先把推理选择编码成 Anthropic 字段，再由网关转换一次。Pi 一面发送原始推理请求头，一面映射原生 thinking level 和目标方言。它的连接比较还把 `default` 和 `auto` 视为等价，尽管两者的请求头不同。

原生请求捕获复现了另一项后果：Pi 收到 `maxTokens: 256` 和原生 `reasoning: high`，随后发送 `max_tokens: 16640`。原始产品选择已经通过独立字段携带。因此，原生推理在提供商请求构建器应用产品选择之前，扩大了这次调用的输出限制。

## 决策

Claude Gateway 连接通过经过鉴权的内部请求头携带捕获的推理选择、档位和 Fast 选择。Fast 始终写入显式布尔值，包括 `false`，覆盖继承的自定义请求头；提供商与模型是否支持 Fast 由请求构建器判断。这些选择仍属于连接重建事实。external-cli 路径保留原生 Claude thinking 和受支持的原生 Fast 选项，不接收内部请求控制头。

Claude 的启动基线使用已捕获的装配事实，不在异步准备之后重新读取模型或提供商行。原生 Fast 记录 SDK settings 实际使用的值；后续协调读取当前事实，并识别原生设置的变化。Gateway Fast 记录原始选择。模型槽位只由 warmup 路由装配一次；环境准备不再查询或生成临时模型身份。流的默认选项保留在 settings builder。

Pi 和 Durable 共用的网关 binding 在原生序列化前清除原生请求的 reasoning。它保留显式调用上限、取消、上下文容量、响应解析和回放元数据。网关把捕获的产品选择交给现有 AI SDK 参数构建器。桌面 Pi 的 thinking level 和 adaptive 方言投影被移除。独立运行的 runtime package 保留原生配置 API。

binding 直接注册原生模型元数据，独立的 model-injection 构建器被移除。对上游 store 和 developer role 的兼容性推断不再配置本地回环客户端。协议路由、图片能力、上下文和输出限制，以及 CherryIN 空签名回放仍然保留。原生成本仍显式设为零，因为扩展注册不会应用配置文件加载器的默认值；Cherry 仍是计费所有者。

Pi 在协调连接时比较规范化后的原始推理选择。Gateway 的 Fast 处理只由提供商请求构建器应用一次。公开网关客户端保留协议定义的请求参数；外部请求头不能提供经过内部鉴权的选择。

## 备选方案

- 保留两个推理解释器：原生夹紧和预算扩展可能在权威构建器看到请求之前改变它。
- 移除原生输出限制或压缩元数据：总结、验证调用和上下文管理对这些值有真实用途。
- 移除 AI SDK 的 thinking budget 换算：安装的 Anthropic adapter 会在序列化时加回思考预算；该换算属于另一项 SDK 契约。

## 影响

桌面原生请求中的推理字段属于传输所需的协议内容。最终提供商请求承载产品选择。预热连接仍然冻结其选择；本修复不增加会话配置存储或实时修改机制。

可选响应元数据、格式错误的工具调用、流截断和错误重试分类仍属于独立的兼容性工作。没有升级依赖或新增依赖补丁。

## 验证

- Regression — `src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts`：捕获的选择覆盖继承请求头，装配后 CLI Fast 变化会要求重建，捕获的请求在后续模型删除时仍可完成准备并由协调识别失效，模型槽位保留各自的回退身份，CLI 订阅保留原生 thinking 且不携带内部请求头。
- Regression — `src/main/ai/runtime/pi/gatewayModelBinding.test.ts`：安装的原生 SDK 在原生推理冲突时仍保留 256 token 的调用上限，使用内部凭证路由受支持协议，保留原生模型容量和图片能力，并保留 Google 与 CherryIN 回放内容。
- Regression — `src/main/ai/runtime/pi/gatewayIntegration.test.ts`：生产网关执行向受控上游发送 `high` 和 `ultra`，存在可信原始选择时忽略冲突的 Anthropic thinking，并保留回放和计费行为。
- Regression — `src/main/ai/runtime/pi/PiRuntimeConnection.test.ts`：在 `default` 和 `auto` 之间切换会重建连接，不再保留旧请求头。

这些是离线 SDK 和本地回环集成检查，不代表真实提供商或 Electron 验收。
