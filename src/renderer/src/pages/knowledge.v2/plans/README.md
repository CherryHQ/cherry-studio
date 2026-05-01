# Knowledge V2 Plans

本目录存放 Knowledge V2 的详细实施计划。

主 README 只保留阶段进度和索引；具体执行说明、边界和验收标准都放在这里。

## 共享约束

以下约束对所有 phase 都生效，除非某个 phase 文档明确写了更严格的补充约束。

### UI 确认边界

- 只允许实现当前 UI 稿里已经可见、可确认的区域和元素。
- 不允许补全未确认的布局、入口、统计块、批量操作或复杂状态。
- 若 UI 稿和现有数据边界冲突，优先停下来定义边界，不做下游 hack。

### 数据边界

- Knowledge V2 的事实来源以 `src/main/data/db/schemas/knowledge.ts` 为准。
- Renderer 侧共享类型以 `packages/shared/data/types/knowledge.ts` 为准。
- 旧 Redux knowledge 状态不能作为 V2 的事实来源。
- 旧 `useKnowledge` 只能作为迁移参考，不能继续扩展成 V2 的基础。

### Renderer 技术边界

- 新 UI 统一使用 Tailwind CSS + `@cherrystudio/ui`。
- 不新增 `antd`、`HeroUI`、`styled-components`。
- 用户可见文案必须走 i18n。
- 页面目录维持当前最小结构，不提前补 `providers`、`shell`、`regions`、`types`、`utils`。

### 结构边界

- `KnowledgePage.tsx` 负责页面级拼装，不承载深层业务细节。
- `components/` 只放页面级结构组件。
- `panels/` 只放右侧 3 个一级 tab 的实现。
- `hooks/` 只放 V2 自己的数据编排逻辑。
- 面板之间不互相直接依赖内部实现。

### 路由替换边界

- `/app/knowledge` 在 phase5 之前不切到 V2。
- 在 phase1 到 phase4 完成前，不混合“半旧半新”的主页面实现。

### 交付边界

- 每个 phase 都必须有明确完成标志，未达到完成标志不进入下一个 phase。
- 如果某个 phase 发现上游接口或 schema 不足，应优先补上游能力，而不是在页面内硬编码规避。
- 测试补齐和清理收尾放在 phase6 统一处理，但不影响每个 phase 保持结构可演进。
