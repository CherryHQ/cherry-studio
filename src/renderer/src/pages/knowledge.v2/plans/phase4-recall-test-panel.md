# phase4 召回测试面板接入

共享约束见 [plans/README.md](./README.md)。

## 目标

实现 `召回测试` 面板，但严格受 UI 稿暴露范围约束，先做最小可用版本。

## 建议落位文件

- `src/renderer/src/pages/knowledge.v2/panels/recallTest/RecallTestPanel.tsx`
- `src/renderer/src/pages/knowledge.v2/panels/recallTest/RecallTestQueryBar.tsx`
- `src/renderer/src/pages/knowledge.v2/panels/recallTest/RecallTestEmptyState.tsx`
- `src/renderer/src/pages/knowledge.v2/panels/recallTest/RecallTestResultList.tsx`
- `src/renderer/src/pages/knowledge.v2/panels/recallTest/RecallTestResultRow.tsx`
- `src/renderer/src/pages/knowledge.v2/hooks/useKnowledgeV2RecallTest.ts`

## 范围

- 实现查询输入区。
- 实现查询触发动作。
- 还原空状态。
- 接入最小结果列表。

## 非目标

- 不发明 UI 稿中没有出现的复杂结果布局。
- 不把调试能力、日志面板、排序策略展示等额外功能塞进来。
- 不把本面板实现耦合进 `RAG 配置` 面板。

## 具体任务

1. 按 UI 稿落地查询输入框和检索按钮。
2. 先完整实现空状态。
3. 接入真实查询动作。
4. 为结果列表定义最小渲染结构。
5. 明确结果数据中哪些字段是检索返回值，哪些只是页面展示态。

## 约束

- 如果当前后端没有稳定的召回测试入口，必须先补上游 API 或 IPC 边界，不能在页面里走临时旁路。
- 结果列表结构只实现最小可用形态，不补未确认的复杂视觉元素。
- 加载态、空状态、结果态、失败态必须明确分离。
- 查询动作必须依赖当前选中的知识库上下文，不能脱离页面主状态单独工作。

## 完成标志

- 用户可以对当前知识库触发一次召回测试。
- 空状态、加载态、结果态边界清楚。
- 结果列表结构足以承载后续细化，但没有预埋 UI 稿外的复杂分支。
