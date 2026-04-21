# phase1 页面骨架落地

共享约束见 [plans/README.md](./README.md)。

## 目标

先把 Knowledge V2 的页面骨架和稳定组件边界立住，不接真实业务数据，不切路由。

## 建议落位文件

- `src/renderer/src/pages/knowledge.v2/KnowledgeV2Page.tsx`
- `src/renderer/src/pages/knowledge.v2/components/BaseNavigator.tsx`
- `src/renderer/src/pages/knowledge.v2/components/DetailHeader.tsx`
- `src/renderer/src/pages/knowledge.v2/components/DetailTabs.tsx`
- `src/renderer/src/pages/knowledge.v2/panels/dataSource/DataSourcePanel.tsx`
- `src/renderer/src/pages/knowledge.v2/panels/ragConfig/RagConfigPanel.tsx`
- `src/renderer/src/pages/knowledge.v2/panels/recallTest/RecallTestPanel.tsx`

## 范围

- 落地页面整体分栏结构。
- 落地左侧导航、右侧头部、右侧一级 tab 切换。
- 为 3 个 panel 建立独立入口组件。
- 允许使用最小静态占位数据驱动页面结构。

## 非目标

- 不接 DataApi。
- 不接旧版 `useKnowledge`。
- 不做真实保存、真实添加、真实搜索、真实召回测试。
- 不新增 provider/context。
- 不替换现有 `/app/knowledge` 路由。

## 具体任务

1. 在 `KnowledgeV2Page.tsx` 中建立页面主拼装。
2. 将左侧导航抽成 `BaseNavigator.tsx`。
3. 将右侧头部抽成 `DetailHeader.tsx`。
4. 将右侧一级 tab 抽成 `DetailTabs.tsx`。
5. 为三个 panel 建立最小占位组件，并让 tab 可以驱动面板切换。
6. 所有结构组件统一切到 Tailwind CSS + `@cherrystudio/ui` 风格。

## 约束

- 左侧导航只实现 UI 稿已经确认的区域：
  - 标题和数量
  - 搜索框
  - 分组列表
  - 底部新建入口
- 右侧头部只实现 UI 稿确认的元信息区和动作区，不增加额外统计或操作。
- 一级 tab 只保留 `数据源`、`RAG 配置`、`召回测试`。
- 静态占位数据只用于驱动结构，不能伪装成真实接口契约。
- 不要在 phase1 里提前抽通用组件库式封装。

## 完成标志

- `KnowledgeV2Page.tsx` 不再是 `return null`。
- 页面大区块和 UI 稿一致。
- 组件边界稳定，后续 phase 能直接在 3 个 panel 内继续扩展。
- 没有引入旧知识库页面的结构耦合。
