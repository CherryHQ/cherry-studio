# Agent Note: Pi 桌面恢复由各状态所有者负责

Status: implemented

[English](2026-11-04-pi-desktop-owner-recovery.md) | 中文

## Problem

Pi 本地命令可能在原生文件创建前确认状态已处理。手动压缩没有可停止的 behavior 运行，关闭流程又先等待其接纳完成，再执行取消。子会话构建失败会留下运行中记录。崩溃恢复排除了已绑定原生上下文的产品占位消息，而网关转换器会丢弃续接所需的 reasoning 身份、加密内容和签名。固定版本的 AI SDK 还会在网关收到事件前，过滤携带 provider 元数据的空文本增量。

## Decision

固定版本的 Pi SessionManager 提供显式首次落盘入口，本地命令落盘后才确认处理完成。中断和关闭在等待接纳完成前取消原生压缩。子会话打开失败在报告任务启动前通知 behavior 生命周期，由已有的运行结束决策记录失败并释放名额，不回滚成功的兄弟任务。

桌面运行时选择需要在重启时收尾的 Pi 占位消息。消息服务执行该选择，保留原生绑定和恢复 token；由投递流程拥有的轮次仍交给投递恢复。网关转换器保留原生重放元数据：Responses reasoning ID 和密文、Anthropic redacted thinking，以及 Google 文本和思考签名。AI SDK 补丁转发只有元数据的文本增量，不添加可见文本；没有元数据的空增量仍被过滤。

## Alternatives considered

- 产品 submission journal 或转录重建会重复原生持久化，无需引入。
- 为解除产品历史阻塞而删除原生绑定，会丢弃有效的续接身份。
- 一个子会话构建失败就回滚所有子会话，会撤销已成功接纳的兄弟任务。
- 绕过网关直连 provider 会分裂凭据与计费所有权；协议修复应由现有网关转换器负责。

## Consequences

本地状态无需模型调用即可在重开后恢复。重启会收尾失去所有者的产品展示，不重试输入，也不宣称能恢复外部副作用。Pi 的小幅固定版本 API 扩展需要在升级时保留兼容性覆盖。真实 provider 和 Electron 验收仍独立于这些离线回归测试。

## Verification

- Regression — `PiRuntimeConnection.test.ts`：首次 `/goal` 和计划模式暂停的目标在确认前落盘，并通过真实 SQLite 绑定重开。
- Regression — `behaviorRuntime.test.ts`：Stop 和关闭会取消独立执行的手动摘要，并完成关闭。
- Regression — `behaviorAdapter.test.ts`：子会话构建失败释放名额，同时保留正常的兄弟任务。
- Regression — `AgentSessionSubmission.test.ts`：选中的原生占位消息转为终态，编辑解除阻塞，原生身份保持完整。
- Regression — `gatewayIntegration.test.ts` 及协议转换器测试：Responses 密文、Anthropic redacted thinking 和 Google 文本及思考签名能经过生产网关并进入 Pi 下一次原生请求，计费仍只有一个所有者。
- Regression — `aiSdkTextMetadata.test.ts`：ESM 和 CommonJS 两种构建均转发只有元数据的文本更新，同时保留可见文本和最终内容元数据。
