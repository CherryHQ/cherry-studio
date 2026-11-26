# Agent Note: Windows 下使用 Alt+Space 显示/隐藏应用

Status: implemented

[English](2026-11-26-alt-space-show-shortcut.md) | 中文

## Problem

Windows 下无法将“显示应用”全局快捷键（`app.window.show`，即 `shortcut.app.window.show`）录制为 Alt+Space：操作系统在按键到达 Chromium DOM `keydown` 之前就打开了窗口系统菜单，因此设置录制器永远捕获不到该组合键。

## Decision

- 快捷键录制器仅在 Windows 下为 `app.window.show` 提供手动“使用 Alt+Space”按钮，并提示启用后将接管系统菜单快捷键。默认绑定保持为空，Alt+Space 为可选启用。
- 保存后沿用现有 `globalShortcut` 注册流程；注册失败时沿用已有的“被系统或其他应用占用”冲突提示。
- 先注册新的加速键，成功后再释放被替代的旧加速键；被拒绝的替换不会留下两个热键同时失效的空隙。
- 仅 Windows 下 `app.window.show` 的 Alt+Space 替换被拒绝时，才恢复上一次注册成功的偏好；其他全局快捷键被拒绝时仍保留用户填写的值与冲突提示（历史行为）。
- 主窗口处于聚焦状态且已保存绑定为 Alt+Space 时，`before-input-event` 吞掉该按键，使系统菜单不会盖在切换动作之上弹出。

## Alternatives considered

- 在录制器中直接捕获 Alt+Space 不可行：操作系统在按键到达渲染进程之前就已将其消费。
- 通过原生 Win32 消息钩子压制菜单会增加原生实现面，且没有额外覆盖；绑定成功后 `globalShortcut`（RegisterHotKey）已优先于系统菜单。
- 将 Alt+Space 作为默认绑定过于侵入：未经用户同意就劫持所有 Windows 用户的系统菜单，因此未采用。

## Consequences

Windows 用户可以绑定 Alt+Space，其他平台不受影响。绑定期间，主窗口的 Alt+Space 将打开应用而非系统菜单。不声称已在实体 Windows 硬件上完成打包产物端到端验证。

## Verification

- Regression — `src/renderer/pages/settings/__tests__/ShortcutSettings.test.tsx`：Windows 下回退按钮可见、无需按键捕获即可赋值、冲突拦截，以及非 Windows 与其他快捷键下隐藏。
- Regression — `src/main/services/__tests__/ShortcutService.test.ts`：Alt+Space 全局注册、注册冲突广播、聚焦窗口下系统菜单压制、Alt+Space 被拒时保留旧热键注册并恢复其偏好，以及非 Alt+Space 与非 show 快捷键被拒时行为不变。
- Regression — `src/shared/utils/__tests__/shortcut.test.ts`：Alt+Space 为合法绑定，可从 Win32 Alt+Space 按键事件解析。
- Regression — `src/shared/utils/command/__tests__/keybindings.test.ts`：`app.window.show` 的 Alt+Space 偏好解析为 `Alt+Space` Electron accelerator。
