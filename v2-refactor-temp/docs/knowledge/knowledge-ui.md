# Knowledge UI V2 重构约束

本文档只记录 Knowledge V2 UI 重构的硬约束，用于统一组件结构、数据边界和协作方式。

它不定义任何未确认的视觉稿、交互稿或页面细节。

## 1. 组件结构设计约束

- Knowledge V2 UI 实现统一使用 Tailwind CSS + `@cherrystudio/ui`（cherry-ui）。
- Knowledge V2 UI 优先复用 `@cherrystudio/ui` 已有的 primitive / composite 组件，不在业务页面中直接实现一套新的基础 UI。
- 对按钮、输入框、下拉、文本域、弹层、标签页、滚动容器等基础交互，优先使用 cherry-ui 组件，不直接使用原生组件作为业务实现方案。
- 如果 cherry-ui 暂时缺少所需能力，优先补齐 `@cherrystudio/ui` 或先回到设计 / 组件层确认，不接受在 Knowledge V2 UI 中直接回退到原生基础组件的临时方案。
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
- Knowledge V2 UI 的 renderer 侧领域类型统一复用 `packages/shared/data/types/knowledge.ts`，不再在页面目录重复定义 knowledge base 主数据类型。
- 知识库与知识项相关 UI，应围绕 `knowledge_base` 与 `knowledge_item` 的 SQLite 结构来设计和实现。
- 不再使用原先 Redux knowledge 数据作为事实来源。
- 任何旧实现中存在、但不在 `knowledge.ts` 中稳定定义的字段，不应继续作为 V2 UI 的设计前提。
- `itemCount`、知识库级 `status` 等列表展示字段属于基于 `knowledge_item` 的派生聚合结果，不属于 `knowledge_base` 主数据。

### 当前暂留问题：`itemCount` / 知识库级 `status`

- 当前阶段先保留该问题，不在本轮 UI 接入里彻底解决。
- `itemCount` 与知识库级 `status` 仍然视为列表展示所需的聚合字段，而不是 `KnowledgeBase` 主数据字段。
- 当前 renderer 已接入真实 `knowledge base` 与当前选中知识库的 `knowledge items`，但没有为所有知识库统一拿到真实聚合结果。
- 当前页面不再维护按知识库补丁的页面侧 mock patch；在上游聚合语义明确前，列表展示所需的 `itemCount` / `status` 统一回退到 `0` / `completed` 默认值。
- 因此，UI 上如果出现“数据源面板能看到当前知识库真实条目数，但列表或头部仍显示默认值”这类现象，应视为当前阶段的已知问题，而不是局部 UI bug。
- 后续如果要正式解决，优先改上游 DataApi：
  - 由 `/knowledge-bases` 列表接口或单独的 summary/list DTO 返回 `itemCount`、知识库级 `status`
  - 不建议在 renderer 中为每个知识库逐个查询 `knowledge items` 后自行聚合，避免 N+1 请求和状态不一致
  - 不应把这两个聚合字段直接并回 `packages/shared/data/types/knowledge.ts` 中的 `KnowledgeBase` 主类型
- 后续上游定义聚合语义时，需要同步明确：
  - `itemCount` 统计的是数据库中的全部 `knowledge_item`
  - 还是 UI 当前实际展示的顶层 item 数
- 现阶段 UI 对 `directory` / `sitemap` 展开的子项采用“先不显示”的策略，因此如果未来按 UI 展示口径统计，需排除带 `parentId` 的子项；在旧数据兼容期内，也要注意当前可能仍存在通过 `groupId` 表达 owner / child 关系的历史数据。

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
