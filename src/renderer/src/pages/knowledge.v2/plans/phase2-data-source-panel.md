# phase2 数据源面板接入

共享约束见 [plans/README.md](./README.md)。

## 目标

优先打通 `数据源` 面板，让 Knowledge V2 的主视图先可用。

## 建议落位文件

- `src/renderer/src/pages/knowledge.v2/panels/dataSource/DataSourcePanel.tsx`
- `src/renderer/src/pages/knowledge.v2/panels/dataSource/DataSourceFilters.tsx`
- `src/renderer/src/pages/knowledge.v2/panels/dataSource/KnowledgeItemList.tsx`
- `src/renderer/src/pages/knowledge.v2/panels/dataSource/KnowledgeItemRow.tsx`
- `src/renderer/src/pages/knowledge.v2/hooks/useKnowledgeV2Bases.ts`
- `src/renderer/src/pages/knowledge.v2/hooks/useKnowledgeV2Items.ts`
- `src/renderer/src/pages/knowledge.v2/hooks/useKnowledgeV2Selection.ts`

## 范围

- 接入知识库列表。
- 接入当前知识库详情上下文。
- 接入知识项列表。
- 接入类型筛选和基础空状态。

## 非目标

- 不实现 RAG 配置保存逻辑。
- 不实现召回测试逻辑。
- 不为分组标签、彩色状态点等未稳定字段补假数据逻辑。
- 不在 phase2 里切路由。

## 具体任务

1. 确认知识库列表和知识项列表的读取边界。
2. 在 `hooks/` 中建立 V2 专用读取 hook，命名和职责与旧 `useKnowledge` 隔离。
3. 将左侧导航和右侧数据源面板接到同一选中知识库状态。
4. 落地筛选项：
   - 全部
   - 文件
   - 笔记
   - 目录
   - 网址
   - 网站
5. 实现基础空状态和无数据状态。
6. 对列表项结构做最小可演进拆分，避免单个组件包办所有分支。

## 约束

- 所有字段必须能映射回 `knowledge_base` 或 `knowledge_item`。
- 对 UI 稿中出现但 schema 尚未稳定解释的字段，先不写死：
  - 分组标签
  - 彩色状态点
  - 非文件项的 chunks 展示
  - 时间文案的最终规则
- 不允许为兼容旧页面而继续沿用 `KnowledgeContent.tsx` 的结构。
- 列表项类型差异通过显式分支组件处理，不要堆布尔开关。

## 完成标志

- 左侧知识库切换能驱动右侧数据源列表更新。
- 数据源面板能独立渲染筛选、列表和空状态。
- 页面主视图不再依赖旧版 `pages/knowledge/` 的核心结构。
