# Agent Note: 在一次对话框提交中接受多个知识库链接

Status: implemented

[English](2026-11-17-knowledge-multi-url-input.md) | 中文

## Problem

添加多个网页数据源曾需要反复使用单链接对话框。混合粘贴需要提供可操作的错误反馈，既不丢失合法项，也不在修正后再次导入它们。

## Decision

对话框按物理换行、英文逗号和空白字符拆分输入。每个 token 保留原始行号和批内序号，使用共享的 `isHttpUrl` 校验，并保留 trim 后的原文及重复项。所有合法项通过既有的 `knowledge.add_items` 以 `detect` 策略一次批量提交，不等待抓取或索引完成。

冲突重试使用 `rename` 或 `replace` 重放已捕获的合法项与非法项快照。检测到冲突时不接受任何项，输入保持原样；取消后恢复编辑该输入。提交和冲突选择期间禁用编辑。

接受后，全合法批次关闭对话框。混合批次保持打开，输入仅替换为未提交的非法 token，并报告已接受的输入数和待修正项数。因此修正不会再次提交已接受项。IPC 或数据库异常仍作为整批错误呈现，不声称部分成功。

[URL 校验决策](../bug-fix/2026-11-07-knowledge-url-validation.md) 继续负责 IPC 校验：混合非法项的 IPC 请求仍整批拒绝。筛选发生在对话框调用该边界之前。导入管道、URL 标识、任务队列、抓取并发及文件、目录、笔记流程保持既有契约。

## Alternatives considered

- 整体拒绝粘贴内容，会导致所有 token 修正完毕之前都无法接受合法项。
- 每个 URL 单独请求，会改变批次冲突语义并增加 IPC 开销。
- 关闭后仅用 toast 反馈，会丢失修正上下文；在输入中保留已接受链接，则有重复导入风险。
- 归一化或静默去重 URL，会改变数据源标识和冲突选择。

## Consequences

多行输入框有可访问标签且高度受限。非法项反馈支持长 token 换行和滚动，最多渲染 100 项及剩余计数；这是反馈上限，不是提交数量上限。Renderer 的全部 17 种语言都提供分隔符说明、逐项错误、合法计数和接受结果文案。

接受表示输入已进入既有处理管道，不表示索引完成，也不表示替换策略下的输入数等于数据库净新增行数。任意大批次仍有同步导入成本。受限环境中尚缺 Electron 布局、主题和响应性的手动验证。

## Verification

- AC1 — `src/renderer/pages/knowledge/utils/__tests__/parseKnowledgeUrls.test.ts`：混合分隔符保留物理行号、token 顺序、URL 原文和重复项，并拒绝非 HTTP(S) 输入。
- AC2 — `src/renderer/pages/knowledge/components/__tests__/AddKnowledgeItemDialog.test.tsx`：十个合法链接一次提交；九个合法加一个非法仅保留非法 token，修正后只提交一次，不再包含已接受的九项。
- AC3 — `src/renderer/pages/knowledge/components/__tests__/AddKnowledgeItemDialog.test.tsx`：重复 URL 的冲突选择重放合法快照；取消保留输入；异常报告整批失败；直接选择和笔记流程保留回归覆盖。
- AC4 — `src/main/features/knowledge/__tests__/KnowledgeService.integration.test.ts`：十个 URL 输入在空的活跃知识库中保存为十个不同 ID，URL 数据对应且初态为 `processing`。
- AC5 — `src/renderer/pages/knowledge/components/__tests__/AddKnowledgeItemDialog.test.tsx` 和 `scripts/i18n-check.ts`：非法反馈限制为 100 项并显示剩余计数；全部 renderer 翻译通过目录校验。
