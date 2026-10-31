# Agent Note: 限制附件 token 计数并验证可容纳的前缀

Status: implemented

[English](2026-10-29-attachment-token-count-bounds.md) | 中文

## 问题

报告者的诊断调用栈为 `RegExpStringIterator.next → BytePairEncodingCore.countNative → GptEncoding.countTokens → allocateInlineCaps → applyInlineCaps → prepareChatMessages → AiService.streamText`：一次普通聊天在流式输出开始前因 `RangeError: Maximum call stack size exceeded` 而失败。修复前，该调用既没有输入上限，也没有异常保护：完整附件正文（`attachmentBudget.ts:79`）和二分查找中的半段正文前缀（`:125`）直接传给依赖的 o200k `countTokens`，而 `applyInlineCaps` 到 `AiService.streamText` 之间没有捕获异常，因此本地异常会使请求准备失败。

单次完整正文计数的冷启动实测耗时：50 000 个相同字符 ≈ 0.6 s，200 000 ≈ 10 s，400 000 ≈ 42 s；在 400 000 字符时，尝试的每种文本形态也都超过了 8 s 的墙钟时间限制。另外，`charCapFor` 假定为避开代理对而回退截断位置不会增加 token 数，但实际可能增加：`"\uFFFD".repeat(7) + "😀" + "x".repeat(7)` 长度为 16 个单元，全文计数为 5；分配 1 个 token 时返回了 7 个单元，其计数却为 2。

报告者的原始附件不可用；本地**未**复现 `RangeError` 本身（十种文本形态 × 200 k–8 M 字符，使用默认及缩小的栈大小）。

## 决策

在 `src/main/ai/tokens/textTokenizer.ts` 中，o200k 适配器保留公开接口形态（具有 `id` 和 `count` 的 `TextTokenizer`、惰性加载 ranks、`disallowedSpecial: new Set()`），并使用私有的 16 384 个 UTF-16 单元阈值：更长的文本直接按 UTF-8 字节长度计价，不调用编码器；较短文本保留精确计数；依赖抛出任何异常时，也返回字节长度。字节长度是该 byte-BPE 计数的上界，因为每个普通 token 至少覆盖一个 UTF-8 字节；已使用 ASCII、CJK、emoji、孤立代理项及跨分块边界文本验证这一点。

在 `src/main/ai/messages/attachmentBudget.ts` 中，`charCapFor` 保留基于实测计数的前缀搜索和全文可容纳时的快速路径，然后通过现有的 `surrogateSafeEnd` 辅助函数规范化候选截断位置（重复应用，使末尾连续未配对高代理项的处理达到稳定状态），对该前缀计数，只有计数不超过分配额度时才接受，否则将截断位置减半并重新检查；零是最终可安全返回的结果。契约保证返回经过验证、能容纳的前缀，不保证它是最长的可容纳前缀。

共享注水分配器、使用 `ATTACHMENT_INPUT_SAFETY_RATIO` 推导共享池的方式、UTF-16 续读偏移量及措辞、`READ_FILE_PAGE_SIZE`、路由层有意不设置恢复性异常捕获的设计、`tokenx`、方言分派和惰性加载均保持不变。

## 备选方案

- 按 16 384 个单元分块后累加计数：不采用，因为可能低估——一个 16 410 单元的正文（`"\n"` × 16 383 + `" abc…xyz"`）全文计数为 1 030，分块计数却为 1 027；对于 token 上限而言，这个误差方向不安全。
- 使用 `gpt-tokenizer` 的 `isWithinTokenLimit`：不将其用作限制计算量的机制，因为对 400 000 个空格设置 100 000 的限制时，它仍耗时 41 s。
- 分配失败时，每个文件回退到固定的 `READ_FILE_PAGE_SIZE`：不采用，因为这会重新引入已被共享池取代的逐文件保底额度。
- 将计数移到 worker：不在本修复范围内。

## 后果

### 影响

每个超过 16 384 单元的 openai 方言字符串都按字节计价：ASCII 散文约为真实计数的 4.9×（102 168 字节，对应 20 899 个 token），可压缩空白文本的倍数更高。这不仅影响附件正文，也影响系统提示词、历史消息、工具文本和网关估算，因此超大请求内联的头部更小，共享池也更早耗尽；对于不支持工具的模型，头部只是变得更小。

不超过阈值的字符串保留精确计数，阈值以下仍可能出现耗时较长但成功返回的计数，这不在本修复范围内。本修复不增加与提供商计数完全一致的承诺；现有安全比例保持不变。

## 验证

- Regression — 四个契约测试文件（`tokens/__tests__/textTokenizer.test.ts`、`tokens/__tests__/footprint.test.ts`、`messages/__tests__/attachmentBudget.test.ts`，以及新增的 `messages/__tests__/attachmentRouting.tokenCounting.test.ts`）在修复前版本上有 15 of 64 条断言失败（生产代码为 `0dd8cf3`，测试复制到该版本），在本分支上则通过 64/64。
- Regression — 一个真实适配器的 RED 用例可确定性重现：`"A".repeat(16_385)` 修复前计数为 2 049，修复后为 16 385。
- Regression — 消费方测试集（profiles、routing、ReadFileTool、gateway fallbacks、in-loop compaction、shouldDefer）保持通过，ESLint、Oxlint、Oxfmt 和 node 类型检查也均通过。

适配器冷启动实测：一个修复前超过 8 s 墙钟时间限制的 400 000 字符正文，现在可在不到一毫秒内返回按字节计价的计数。
