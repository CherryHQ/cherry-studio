# Agent Note: Claude Code 身份快照的有界交付

Status: implemented

[English](2026-10-28-claude-code-identity-context-cap.md) | 中文

## 问题

Claude Code CLI 子进程对 hook 的 `additionalContext` 按每个字符串 10,000 个 UTF-16 code unit 限制。超限时，它把内容保存到 session 目录，只将文件路径和前 2,000 单元预览交给模型，不报错、不告警。`createClaudeCodeIdentityHooks()` 此前把 `PromptBuilder.buildMemoriesSection()` 的完整快照作为单条字符串返回。`SOUL.md`、`USER.md` 与 `memory/FACT.md` 合计超限后，模型每回合只能看到预览。Issue #22945 报告的快照有 86,178 字符，只有 2.32% 到达模型。

使用 `@anthropic-ai/claude-agent-sdk` 0.3.284 的真二进制与本地 mock 上游实测：10,000 单元完整到达，10,001 起截断。纯中文 9,000 字 / 27,000 bytes 完整到达，emoji 文本在 10,001 个 UTF-16 单元时截断。因此上限既不按字节，也不按 code point 计量。

同事件多个 hook 按字符串独立计量：2×8,000 单元的探针中，两条字符串均完整到达。但 hook 并发执行，内容按完成顺序进入上下文。将 callback 0 延迟 250ms 后，callback 1 的内容出现在前面，数组顺序不决定模型看到的顺序。SDK initialize 会序列化 callback ID，因此 callback 数量在 query 建立时固定，且没有公开的动态注册 API。本仓修复必须显式声明容量上限。

## 决策

保留 hook 通道和两个事件。`SessionStart` 强制重发，包含 compaction 后的重注入；`UserPromptSubmit` 按连接去重。每个事件注册一个 matcher，内含 16 个固定 callback。每片正文预算为 9,600 单元，名义容量为 153,600 单元。容量按实际切片数判定；换行和代理对边界可能使实际容量低于名义值。

每片携带 `<agent_identity_part>` 元数据，包含 `batch`、`part="k/N"`、`units` 与 `truncated`，以及固定说明：片段可能乱序，按编号拼接正文且不得增删字符，整批替换此前所有身份快照，单片不是完整快照。切片是无损纯函数：`chunks.join('') === snapshot`，不拆代理对，并优先在换行处切分。

每个事件每回合只读一次快照、只做一次是否发送的决定，全部槽位共享。快照未变时，16 个槽位均返回 `{}`。取消或失败不更新 `delivered`，旧批次也不能覆盖新批次的交付状态。

超容量时交付前缀，所有片段标记 `truncated="true"`。最后一片给出 `snapshotUnits`、`deliveredUnits`、`omittedUnits`，以及 `SOUL.md`、`USER.md`、`memory/FACT.md` 的绝对路径。它声明遗漏内容未知，禁止用旧快照补齐。主进程按连接去重，发出不含快照正文的结构化 warning。若超容量说明及其包装本身也放不下，则整批不发，并发出 warning。

稳定系统提示也说明：运行时可能以一条或多条 `<agent_identity_part>` 交付，片段可能乱序，必须按 `part` 拼接正文，只有整批才完整。

## 备选方案

1. 改走 issue 首选建议 `systemPrompt.append`：`snapshot:false` 只让 CLI 每请求重新渲染，不会回调 Cherry 重新读文件，因此若不修改 query/driver 生命周期，就无法保住 warm connection 每回合刷新以及 compaction 后取最新文件版本的契约。
2. 单 callback 返回完整快照：单字符串上限仍然存在。
3. 只加 UI 或日志告警：可以暴露损失，但不能恢复身份交付。
4. 超限时降级为文件路径与明确 Read 指令：这需要模型调用工具，违反 `prompt.ts` 已有的无需 Read 即知身份的契约；实测落盘文件完整存在，但模型不读取就看不到尾部。
5. 修复上游 CLI 的 hook 上下文交付，让可信 SDK callback 的 `additionalContext` 无损到达，或提供有序的多字符串批次：控制协议已无损携带全部 86,178 字符，因此这是发生损失的根因层，但需要上游实现和发布，超出本仓 PR 范围；本 PR 做有界本地修复，并在 issue 讨论中记录这一上游方向。

## 影响

容量内，完整身份无需工具调用即可到达模型，覆盖 compaction 重注入、resume 重载和每回合刷新；快照未变时不重复注入。代价是每次 `UserPromptSubmit` 即使未变也有 16 次 callback 控制往返。探针对比 9 片与 1 片时，整条 query 耗时差约 28ms；未变更回合不注入正文。

到达顺序没有保证，因此协议依靠元数据。模型重组仍属指令契约，不是确定性执行保证，[智能体提示词分层](../../../../docs/references/ai/agent-prompt-layers.md) 已采用同一前提。

超过 153,600 单元，或受换行/代理对边界影响的更低实际容量时，交付显式降级为前缀、准确计数和来源路径。能否通过 Read 补全取决于工具可用性与权限。这里的“已交付”只表示本地 16 个 callback 都准备好了返回结果，不表示 CLI 或模型已确认收齐。SDK 没有共同事件实例 ID，同键重叠事件的迟到槽位无法静态区分；代码已注释这一限制。

通过 i18n、IPC 和 toast 提供 UI 可见告警不在本 PR 内，留作 follow-up。

## 验证

以下为本 PR 已有运行记录，并非新增此 note 时重新执行的结果。

- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/runtime/identity.sdkContract.test.ts -t 'delivers the complete oversized Claude identity without a tool read'`（RED，超长身份完整交付）：仅将新增测试复制到 base `1250b45` 的探针副本，产品文件保持旧版，结果为 `Tests 1 failed | 5 skipped`，rc=1；`expect(text).toContain('IDENTITY_FACT_TAIL_22945_7d2c86ea')` 失败，模型 messages 中只有 `<persisted-output>` 和 2,000 单元预览。
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/runtime/identity.sdkContract.test.ts`（GREEN，原生 SDK 身份契约）：6 passed，rc=0；超长身份无需 Read 即可精确重组为 `buildMemoriesSection()` 原串，长身份覆盖首轮、改尾、不变、真实 compact 和 resume。
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/runtime/claudeCode/__tests__/identityChunks.test.ts src/main/ai/runtime/identity.test.ts src/main/ai/agents/__tests__/prompt.test.ts`（切片、hook 状态和提示词契约）：69 passed，rc=0。
- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts src/main/ai/runtime/claudeCode/__tests__/buildSystemPrompt.test.ts src/main/ai/runtime/claudeCode/__tests__/hooks.steer.test.ts src/main/ai/runtime/claudeCode/__tests__/bashOutcomeRecording.test.ts`（受影响的消费者）：211 passed，rc=0。
- Regression — `NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` 与 `NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json --composite false`（静态类型）：均 rc=0；web 检查需增大堆内存。
- Regression — `node node_modules/oxlint/bin/oxlint --deny-warnings`、`node node_modules/eslint/bin/eslint.js --no-cache` 与 `node node_modules/oxfmt/bin/oxfmt --check`（附带 PR 验证日志记录的变更文件参数）：被检查的源码均 rc=0；Oxfmt 忽略了 Markdown，不能据此声称 Markdown 格式已验证。
- Regression — `node node_modules/tsx/dist/cli.mjs scripts/docsGovernance/check-doc-links.ts`、`node node_modules/tsx/dist/cli.mjs scripts/docsGovernance/verify-doc-structure.ts`、`node node_modules/tsx/dist/cli.mjs scripts/docsGovernance/verify-doc-frontmatter.ts`、`node node_modules/tsx/dist/cli.mjs scripts/docsGovernance/verify-translation-pairing.ts`、`node node_modules/tsx/dist/cli.mjs scripts/docsGovernance/gen-doc-index.ts --check` 与 `git diff --check`（文档与空白闸门）：docsGovernance 五项及 diff 检查均 rc=0。

中文快照按 UTF-16 单元计量：9,000 汉字 = 27,000 bytes 仍完整，不按字节截断。
