# phase5 路由切换与旧实现下线

共享约束见 [plans/README.md](./README.md)。

## 目标

在 V2 页面主体能力稳定后，再把 `/app/knowledge` 的入口切过来，并逐步下线旧实现。

## 建议落位文件

- `src/renderer/src/routes/app/knowledge.tsx`
- `src/renderer/src/pages/knowledge.v2/KnowledgePage.tsx`
- `src/renderer/src/pages/knowledge/` 下仍被旧页面占用的相关文件

## 范围

- 切换路由入口。
- 迁移仍被 V2 依赖的少量旧能力。
- 标记或删除不再使用的旧知识库页面文件。

## 非目标

- 不在这一阶段重做 V2 页面结构。
- 不把“路由切换”变成“继续拖着旧页面共存很久”。

## 具体任务

1. 确认 phase1 到 phase4 的完成标志都已满足。
2. 盘点旧版 `pages/knowledge/` 中是否还有未迁移的能力。
3. 路由入口改为指向 `KnowledgePage`。
4. 对旧页面代码做保守清理：
   - 仍被别处依赖的，先迁移或下沉
   - 已无引用的，再删除
5. 检查是否还残留旧知识库页面的样式和行为耦合。

## 约束

- phase5 之前不允许切 `/app/knowledge`。
- 如果旧页面里还有关键能力未迁完，先补能力，不做“新页面里偷引用旧页面组件”的混搭方案。
- 删除旧文件前必须先确认引用关系，不做粗暴清理。
- 新旧实现切换后，Knowledge V2 必须成为唯一主实现。

## 完成标志

- `/app/knowledge` 指向 `KnowledgePage`。
- 旧知识库页面只保留必要兼容代码，或被安全删除。
- 主入口不再依赖旧版页面结构。
