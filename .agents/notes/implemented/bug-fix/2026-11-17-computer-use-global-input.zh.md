# Agent Note: 为 Computer Use 动作授权全局输入

Status: implemented

[English](2026-11-17-computer-use-global-input.md) | 中文

## 问题

Computer Use 服务会在动作执行前检查既有的桌面控制偏好，但随后对每个原生动作都强制写入 `allowGlobalInput: false`。因此需要全局指针或键盘输入的 Linux X11 与 Wayland 动作无法使用用户已开启的权限。

## 决定

在服务既有的 `assertAvailable` 授权检查通过后，为 `act` 与 `perform` 调用传入 `allowGlobalInput: true`。继续使用现有偏好、停止状态、任务所有权和原生权限检查作为授权边界；不新增第二个设置，也不允许调用方绕过服务检查。

## 备选方案

- 新增仅 Linux 的第二个偏好：会重复既有桌面控制授权并产生冲突状态。
- 保留 `false`，让调用方覆盖：属性是在调用方动作之后写入的，调用方无法覆盖，文档中的 Linux 输入路径仍不可用。
- 删除服务层的赋值并依赖原生默认值：原生默认值是 `false`，需要全局输入的动作仍会被禁用。

## 影响

获得授权的 Computer Use 动作可以在 Linux 上请求全局输入。桌面控制被禁用、停止或不可用时服务仍会拒绝动作；macOS 与 Windows 也收到相同的显式动作标志，而其原生适配器已能处理该参数。

## 验证

- 回归 — `src/main/services/__tests__/ComputerUseService.control.test.ts`：已授权的 `act` 与 `perform` 调用包含 `allowGlobalInput: true`。
