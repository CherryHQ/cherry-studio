# Agent Note: 显式启用 Computer Use 全局输入

Status: proposed

[English](2026-11-14-computer-use-global-input.md) | 中文

## 问题

`ComputerUseService` 在展开动作后，在原生 `act`、原生 `perform` 以及 `perform` 中回退的 `act` 三个位置硬编码 `allowGlobalInput: false`。Linux 上需要全局输入的动作因此无法通过运行时权限检查。Hyprland 虚拟键盘没有可用于批准此标志的对话框。

## 提案

使用独立且默认关闭的 `app.computer_use.global_input.enabled` 偏好。每次调用在审批、获取客户端和可用性检查之后、分发之前读取一次。在三个位置均将其放在动作展开之后，使其在两个方向上都覆盖调用方标志。保持工具和自动化模式不变。

主桌面控制开关关闭时保留已存储的选择；被禁用的子开关仍显示存储值。使用独立的保存状态和错误。通过现有权限路由和判断条件，允许请求运行时报告的远程桌面门户、GNOME Shell 和 KDE Plasma 集成权限行；未知标识仍不可请求。

绝不重映射运行时错误或替换其 effect 元数据。偏好关闭时，`PERMISSION_REQUIRED` 也可能表示缺少操作系统授权。改在开关帮助文本中解释范围及保留行为。此决策不改变应用审批、所有权、停止、清理、中止和可用性行为。

## 已考虑的替代方案

- 依附主开关：没有单独选择便授予全局输入。
- 在 Linux 上自动启用：按平台而非用户选择授予访问权限。
- 根据消息文本识别 `PERMISSION_REQUIRED`：掩盖缺少操作系统授权的情况，并覆盖运行时提供的诊断信息和 effect。

## 验收标准

- AC1 — 三个分发分支均遵循偏好，即使调用方标志相反；已打开的会话在下一次动作中使用修改后的值。 (verification: unit; owner: worker)
- AC2 — 关闭时允许语义动作分发，SDK 权限错误保留对象身份、代码及 effect。 (verification: unit; owner: worker)
- AC3 — 开关默认关闭，保存显式启用选择，禁用时显示存储的 true，单独报告保存失败且不显示虚假成功。 (verification: renderer; owner: worker)
- AC4 — 门户权限行请求报告的标识，未知行没有按钮，路由模式接受全部五种标识及混合列表，拒绝未知标识及空列表。 (verification: unit and renderer; owner: worker)
- AC5 — 显式启用后 Hyprland 指针及虚拟键盘输入传递正常，门户授权在设置客户端到任务客户端交接后仍有效。 (verification: Electron on Linux; owner: Linux maintainer)
- AC6 — 产品接受独立且默认关闭的选择及其保留行为。 (verification: product review; owner: maintainer)

## 风险

在用户显式启用之前，Linux 上需要全局输入的动作仍被阻止。启用设置不保证动作成功：操作系统授权、合成器支持和运行时限制仍然适用。

控制测试覆盖分发决定权、两个方向的调用方覆盖、打开会话中的逐次读取、语义动作分发和原样传播运行时拒绝。设置测试覆盖显式启用、禁用时保留 true、保存失败及已翻译的门户请求。直接 IPC 模式测试覆盖全部五种标识、混合列表、未知标识和空列表。实际检查结果见工作报告；存在测试并不证明测试已通过。

Hyprland 指针及虚拟键盘输入传递、设置客户端与任务客户端之间的门户授权生命周期仍未验证：本机没有 Linux 桌面。在运行时验证及产品决策获接受之前，保持此说明为 proposed。
