# Knowledge V2

- knowledge base 领域类型统一来自 `packages/shared/data/types/knowledge.ts`
- 页面只保留展示层派生字段，例如知识项聚合得到的 `itemCount` / `status`
- 分组读取 `KnowledgeBase.groupId`，不再维护页面侧 `group` 枚举
- phase2 已接入真实 `knowledge base` 列表和当前选中知识库的 `knowledge items`，`itemCount` / `status` 暂时统一使用 `0` / `completed` 默认值，后续再讨论上游聚合字段
- phase3 已接入知识库级 RAG 配置读写，`separatorRule` 不再出现在 V2 UI 中，`dimensions` 先保持只读展示

- [x] [phase1 页面骨架落地](./plans/phase1-page-shell.md)
- [x] [phase2 数据源面板接入](./plans/phase2-data-source-panel.md)
- [x] [phase3 RAG 配置面板接入](./plans/phase3-rag-config-panel.md)
- [ ] [phase4 召回测试面板接入](./plans/phase4-recall-test-panel.md)
- [ ] [phase5 路由切换与旧实现下线](./plans/phase5-route-cutover.md)
- [ ] [phase6 测试补齐与收尾](./plans/phase6-tests-and-cleanup.md)
