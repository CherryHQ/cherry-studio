# T-006A 测试数据准备

**状态**：⏳ 待启动
**依赖**：无（与 T-006B 并行）
**预估**：0.5 天

## 目标

让 T-006B–F 的实施 / 调试不依赖真实 AI 调用。提供：
- **fixture**：一组 mock `BranchMessagesResponse`（含 1 条 user message + 1 条带多段 markdown 的 assistant message）
- **如果 baseline 已验证**：可改用真实 provider（OpenAI / Anthropic，避开 D-003 Ollama）跑一条真消息

## 必须包含的内容（用于测各种选区场景）

- 多段 `<p>`（测同段落选区）
- ≥ 1 个 `<h2>` / `<h3>` 标题（测标题选区）
- ≥ 1 个 inline code（测 `<code>` 内选区）
- ≥ 1 个 fenced code block（测代码块选区 — 已有 `extractSelectedText` 行号剥离）
- ≥ 1 个有序列表（测跨 `<li>` 选区 — 应被新菜单项 disable，提示）
- ≥ 1 段含中文 + 标点（测 `extractSelectedText` 边界）

## 放置位置（建议）

- `src/renderer/src/pages/home/Messages/__tests__/__fixtures__/branchAnchor.fixture.ts`（导出常量）
- 或 `src/renderer/src/pages/home/Messages/__tests__/__fixtures__/branchAnchor.fixture.tsx`（带 JSX preview，用于 Storybook 或 dev page）

## 验收

- [ ] fixture 可 import 到 vitest 与 dev page
- [ ] dev page 至少能看到一条 markdown 富文本的 assistant message 渲染
- [ ] fixture 通过 vitest 渲染断言（不报错、关键文本出现在 DOM）

## 不在范围

- 真实 AI provider 配置（用户自己配）
- 多模型 sibling group 数据（v2 sibling 是另一维度，T-006 不依赖）
