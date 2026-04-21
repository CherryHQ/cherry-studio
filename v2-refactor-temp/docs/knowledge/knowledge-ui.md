# Knowledge UI V2 重构约束

本文档只记录 Knowledge V2 UI 重构的硬约束，用于统一组件结构、数据边界和协作方式。

它不定义任何未确认的视觉稿、交互稿或页面细节。

## 1. 组件结构设计约束

- Knowledge V2 UI 实现统一使用 Tailwind CSS + `@cherrystudio/ui`（cherry-ui）。
- UI 文件结构设计优先遵循 `vercel-composition-patterns`。
- Knowledge V2 UI 优先采用 composition-first 的组织方式，优先考虑 compound components、清晰的 slot / children 组合，以及必要时的 provider + context 接口。
- 避免在单一组件中通过大量布尔 props 或模式开关堆叠分支逻辑。
- 同一类 UI 变体优先使用显式变体组件或独立子组件，而不是继续扩展 `isXxx`、`showXxx`、`variant === ...` 这类隐式分支。
- 状态组装与展示职责分离：容器层负责组装数据和行为，展示层只消费清晰、稳定的接口。

## 2. Hook 使用约束

- Knowledge V2 UI 的 hooks 统一切换到 `useKnowledge.v2`。
- 新 UI 不再继续依赖现有 `useKnowledge` 的旧实现，也不再围绕旧 knowledge 数据流做结构设计。
- 旧 hook 仅作为迁移参考，不再作为 V2 UI 的扩展基础。

## 3. 数据来源与字段边界约束

- Knowledge V2 UI 的数据模型与字段边界以 `src/main/data/db/schemas/knowledge.ts` 为准。
- 知识库与知识项相关 UI，应围绕 `knowledge_base` 与 `knowledge_item` 的 SQLite 结构来设计和实现。
- 不再使用原先 Redux knowledge 数据作为事实来源。
- 任何旧实现中存在、但不在 `knowledge.ts` 中稳定定义的字段，不应继续作为 V2 UI 的设计前提。

## 4. UI 确认约束

- 一切未确认的 UI 不得自行添加。
- 任何新增布局、视觉元素、交互入口、状态展示、批量操作或信息区块，在没有确认 UI 稿前都不进入 V2 范围。
- 如果实现过程中遇到 UI 稿缺口，应先回到设计确认，再继续落地。
- 当前文档只定义重构边界，不代表具体页面方案已经确认。

## 5. UI 稿勘查约束

- ui参考稿 https://pecan-stool-05054889.figma.site/
- 当 Knowledge V2 UI 的参考稿来自网页或 Figma Site 时，优先使用 `.agents/skills/knowledge-v2-ui/SKILL.md`。
- 该 skill 用于通过 `opencli` 打开页面、进入侧边栏 `知识库` 标签、提取已确认的 UI 结构，并将结果整理为可实现的界面拆分说明。
- 对网页 UI 稿的分析结论，应只基于页面中实际可见、可验证的元素，不得补全未确认的视觉或交互细节。
- 如果页面中存在同名节点、结构歧义或未暴露的交互入口，应先记录歧义并回到 UI 确认，而不是自行推断。
