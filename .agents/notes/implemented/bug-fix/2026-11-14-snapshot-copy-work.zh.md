# Agent Note: 减少重复的快照复制

Status: implemented

[English](2026-11-14-snapshot-copy-work.md) | 中文

## Problem

流式处理和上下文读取中的同步深拷贝重复遍历了调用方不需要的数据。直接共享可变引用会破坏异步观察、恢复和归档消息的隔离。仅增加 lint 禁令会留下现有热点。

## Decision

保留快照契约，在复制之前选择数据：

- Durable 投影先读取不含消息的 feed 状态，发布新快照时不再两次复制将被替换的历史。
- Pi 恢复使用标量 input 身份，避免逐条复制不断增长的历史前缀。token 更新同步捕获当前块，保留当前完整文本和权威结束校正；完成的工具参数单独捕获。
- 消息投影复用已经隔离且未变化的消息和 part。变化的文本共享不可变字符串，可变元数据仍捕获。无观察者的 child delivery 延迟到快照读取；归档持久化继续，关闭前刷新最终视图。
- Claude live batch 仅在绑定变化时附带 legacy 映射。baseline/recovery 始终包含完整映射；桌面 root 消费者保留最后的映射。每次观察者交付仍独立捕获。
- 临时上下文先选择按 user 回溯对齐的窗口，再复制行。不限制数量的读取仍返回隔离的完整历史。
- usage capture 只执行一次外层 clone-and-freeze；平面的数值费用 breakdown 使用浅复制。

使用 Oxlint 内置 `no-restricted-globals` 和 `no-restricted-properties` 拒绝未标注的新 `structuredClone` 访问，包括测试及经由 `globalThis`、`window`、`self`、`global` 的静态访问。保留的调用级例外说明需要维持的所有权边界。理由是 review 要求，没有自定义解析器检查内容。见 [lint 契约](../../../../scripts/lint/README.md)。

## Alternatives considered

- 不修热点，仅标注旧调用：已确认的多余工作仍然存在。
- 只传引用或增量文本：可能暴露后续原生修改，或丢失块的权威校正。
- 替换为其他深拷贝工具或 JSON 序列化：遍历成本不变，还可能改变支持的值。
- 豁免整个文件或测试目录：宽泛例外会隐藏后续复制。
- 新增自定义 lint 插件：选定的静态访问已由内置规则覆盖。

## Consequences

修复减少复制的数据量，没有消除全部历史扫描或全部深拷贝。公共快照和恢复仍有意完整捕获，变化的工具数据仍需要隔离。尚未接入桌面的 ACP adapter 保留恢复状态复制，这不代表其成本已适合桌面接入。全局对象别名和动态属性名不在规则覆盖范围内。

## Verification

- Regression — 五个聚焦回归用例在旧实现上失败，修复后通过：Durable 被替换历史的复制量、Pi 恢复复制量、投影隔离与复用、无观察者 child delivery、临时窗口选择。计数器包装真实 clone 操作，没有替换为廉价实现。
- Regression — 使用原生脚本模型的 Pi 测试验证最终内容顺序，并确认不再复制完整原生 delta envelope。既有 stream observation 用例覆盖结束校正和工具交错。Claude 测试覆盖未变映射的省略及晚订阅 baseline 隔离。
- Regression — 真实 Oxlint CLI 测试验证仓库配置、直接与限定访问、解构、可选与静态计算访问、窄范围豁免和局部同名标识符。
- Regression — 本地检查提供确定性的复制工作量和契约证据。不宣称生产延迟百分比、Electron 验收或真实 provider 性能结果。实际执行的检查记录在 PR 中。
