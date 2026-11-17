# Agent Note: Claude 分叉的压缩元数据由 SDK 负责

Status: implemented

[English](2026-11-14-claude-fork-opaque-metadata.md) | 中文

## 问题

Claude 分叉准备会递归重映射 `compactMetadata` 中的每个字符串和对象键，将推算值与 SDK 输出比较，并拒绝任何仍然出现的源 UUID。SDK 0.3.311 只重映射它认识的引用字段，其余元数据原样保留。因此，即使分叉保留了相同上下文，只要普通注释包含源 UUID 或已丢弃进度记录的 UUID，就会报 `unsupported_checkpoint`。

## 决策

[Claude worker](../../../../src/main/ai/runtime/claudeCode/forkWorker.ts) 将压缩元数据的解释和重映射交给 SDK，不再推算或递归扫描这些元数据。在暂存前，SDK 历史读回仍要求选中的 checkpoint 可读，且在 SDK 的 UUID 映射下，消息标识、类型和内容的顺序一致。

重复 UUID 检查、内容替换检查、继承 checkpoint 的映射、源文件一致性、取消和发布所有权继续由现有层负责。这是局部兼容性修复，没有引入新的原生历史实现。

## 考虑过的替代方案

- 保留递归推算和扫描：拒绝，因为形似 UUID 的注释值和对象键并不能证明它们是原生引用。
- 在 Cherry 中增加压缩引用白名单：本次修复不采用，因为这会重复解释 SDK 语义，而读回已检查最终上下文。
- 接受所有 SDK 成功返回的分叉：拒绝，因为锁定版本的 SDK 在保留消息通过被排除的 sidechain 建立父引用时可能丢失上下文；现有回归测试继续明确拒绝这种情况。

## 影响

SDK 可读的普通注释不再阻止 Fork 或编辑重发的准备。不支持的 checkpoint 和可观察的上下文变化仍在暂存前失败。读回不能证明所有原生恢复转换都等价，因此原生续聊测试会比较恢复会话实际发出的请求。

测试使用隔离的原生 CLI 配置和按脚本响应的本地模型端点，不能证明 Electron UI、打包应用、真实模型账号或其他操作系统上的行为。

## 验证

- Regression — `pnpm test:main src/main/ai/runtime/claudeCode/__tests__/nativeContract.test.ts --maxWorkers=1`：在重试、压缩、普通注释和保留上下文场景中，比较源会话、子会话及从历史 checkpoint 再次分叉的孙会话的续聊请求；普通注释场景在修复前复现 `unsupported_checkpoint`。
- Regression — `pnpm test:main src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts --maxWorkers=1`：通过真实 SDK worker 验证普通元数据、压缩后保留的上下文、隐藏 checkpoint、被排除的 sidechain、源文件不变及暂存前拒绝。
