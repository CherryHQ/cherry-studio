# Agent Note：保留输入框延迟请求直到实际执行

Status: implemented

[English](2026-11-07-composer-deferred-intent-replay.md) | 中文

## 问题

首次点击工具栏时，富文本输入框可能尚未加载。轻量输入框会记录打开面板、粘贴、拖放或插入令牌的请求，等待编辑器挂载后重放。运行时却在设置重放定时器前清空请求。若中间一次渲染改变 effect 依赖，清理函数会取消定时器，而替代 effect 已无请求可执行。MP-31 间歇复现点击加号却不显示附件菜单，三轮专项执行中出现一次失败。

## 决策

重放尚未执行时保留请求。定时器回调确认编辑器仍然存活后，在实际交付前消费请求。effect 清理可以取消并重新安排尚未完成的工作，后续渲染也不能重复交付已经完成的请求。保留现有定时器清理和编辑器事件路径。

## 考虑过的替代方案

- 在 E2E 辅助函数中重试点击或预加载编辑器，会掩盖首次交互失败。
- 取消延迟定时器会改变与挂载时焦点恢复之间的执行顺序。
- 删除 effect 依赖会保留过期的面板回调。

## 影响

保留既有延迟加载与焦点恢复顺序。工具栏和传输请求在交付前经历渲染也不会丢失，不引入持久状态或数据迁移。

## 验证

- Regression — 组件测试在重放前触发依赖变化，断言实际粘贴文本在编辑器 DOM 中恰好出现一次，并验证事件没有传到 document 粘贴处理器。修复前失败，修复后通过。
- `pnpm test:renderer src/renderer/components/composer/__tests__/ComposerSurface.test.tsx src/renderer/components/composer/__tests__/ComposerSurface.lazy.test.tsx`：212 个测试通过。
- Electron — 修复后 MP-31 连续三轮完成附件上传与解析流程，驱动清理通过。完整跨平台验收尚待完成。
