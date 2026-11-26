# Agent Note：保留输入框延迟请求直到实际执行

Status: implemented

[English](2026-11-07-composer-deferred-intent-replay.md) | 中文

## 问题

首次点击工具栏时，富文本输入框可能尚未加载。轻量输入框会记录打开面板、粘贴、拖放或插入令牌的请求，等待编辑器挂载后重放。运行时却在设置重放定时器前清空请求。若中间一次渲染改变 effect 依赖，清理函数会取消定时器，而替代 effect 已无请求可执行。MP-31 间歇复现点击加号却不显示附件菜单，三轮专项执行中出现一次失败。

轻量输入框向编辑器移交焦点时，还通过 TipTap 的动画帧延迟聚焦。轻量输入框可能在该帧之前卸载，导致焦点落到 document，丢失首个输入字符。

## 决策

重放尚未执行时保留请求。定时器回调确认编辑器仍然存活后，在实际交付前消费请求。effect 清理可以取消并重新安排尚未完成的工作，后续渲染也不能重复交付已经完成的请求。保留现有定时器清理和编辑器事件路径。

面板重放还需等待 QuickPanel 运行时和工具注册完成。编辑器可能先于工具注册挂载；在这段间隔中消费请求，会丢失首次工具栏激活。

通过 TipTap 恢复编辑器选区，然后同步聚焦其 view，再将选区滚动到可视范围。保留其他输入框已激活时的保护，并且只有轻量输入框实际发生过交互才移交焦点。

## 考虑过的替代方案

- 在 E2E 辅助函数中重试点击或预加载编辑器，会掩盖首次交互失败。
- 取消延迟定时器会改变与挂载时焦点恢复之间的执行顺序。
- 删除 effect 依赖会保留过期的面板回调。

## 影响

保留延迟加载；发生过交互的轻量输入框卸载时同步移交焦点。工具栏和传输请求在交付前经历渲染也不会丢失，不引入持久状态或数据迁移。

## 验证

- Regression — `ComposerSurface.test.tsx` 延迟工具注册，并验证保留的请求会在注册后打开 MCP 提示词菜单；加入可用性保护之前，该测试失败。

- Regression — 组件测试在重放前触发依赖变化，断言实际粘贴文本在编辑器 DOM 中恰好出现一次，并验证事件没有传到 document 粘贴处理器。修复前失败，修复后通过。
- `pnpm test:renderer src/renderer/components/composer/__tests__/ComposerSurface.test.tsx src/renderer/components/composer/__tests__/ComposerSurface.lazy.test.tsx`：212 个测试通过。
- Electron — 修复后 MP-31 连续三轮完成附件上传与解析流程，驱动清理通过。完整跨平台验收尚待完成。
- Regression — `ComposerSurface.test.tsx` 与 `ComposerSurface.coldInput.test.tsx` 共 174 个测试通过。使用真实 TipTap 的冷输入用例保护首个字符和焦点移交；已加载编辑器与无交互挂载用例分别保留各自契约。完整 Electron 输入及延后的绘画预设 smoke 用例尚未验收通过。
