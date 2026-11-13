# Agent Note：Agent 维度的 IM 渠道绑定入口

Status: proposed

[English](2026-11-08-agent-channel-binding-entry-points.md) | 中文

## Problem

IM 渠道绑定目前只在全局设置 > 渠道中可用，入口藏得很深，且与具体 Agent 无关。想通过微信或飞书与某个 Agent 对话的用户找不到绑定位置。之前的修复（#15624）让 Agent 口头引导用户去设置页，这只是变通办法，并不是可发现的入口（#15956）。

渠道已通过 `agentId` 保存其所属 Agent，因此绑定模型无需改动，缺的只是入口。

## Proposal

在复用现有 `agentId` 绑定的基础上，新增两个更浅的入口。全局设置 > 渠道入口保持不变。

- **Agent 列表菜单。** 每个 Agent 的菜单新增「连接到 IM…」，点击后打开该 Agent 的设置对话框，并默认停留在渠道标签页。
- **Agent 设置对话框。** 新增渠道标签页，也可直接打开，列出支持的 IM 渠道（微信、飞书、Telegram、QQ、Discord、Slack 以及其他可用类型）。开启某个渠道即将其绑定到该 Agent；关闭则清除该 Agent 在该类型上的绑定。

绑定规则：

- 开启渠道时，若存在同类型且未绑定的渠道则复用，否则按该类型的默认配置新建。飞书和微信新建后即启用，因为它们通过二维码注册；其他类型需先填写凭据，新建后保持未启用。
- 已绑定但未启用的渠道会显示提示，并链接到渠道设置。启用操作仍在设置页完成。
- 绑定以 Agent 为作用域。未绑定任何渠道的 Agent 行为与现在一致，不会强制绑定。

## Alternatives considered

- **只提供全局设置的深层链接。** 即现状；议题认为入口太隐蔽，已否决。
- **只在渠道设置页绑定，并在 Agent 卡片上加「连接」按钮。** 否决：用户已在 Agent 设置对话框中配置 Agent，议题也要求在此处提供入口。
- **绑定时自动启用已有渠道。** 否决：需要凭据的渠道会在启用校验时失败。改为显示提示。

## Acceptance criteria

- AC1 — 每个 Agent 的列表菜单中都有「连接到 IM…」项。（verification：renderer 测试）
- AC2 — 点击该项会打开 Agent 设置对话框，并停留在渠道标签页而非默认标签页。（verification：renderer 测试）
- AC3 — 直接打开 Agent 设置对话框时存在渠道标签页，并显示该 Agent 当前的绑定。（verification：renderer 测试）
- AC4 — 在渠道标签页开启受支持的渠道会将其绑定到该 Agent，且刷新后绑定保持。（verification：renderer 测试、Electron）
- AC5 — 关闭渠道会解除其与该 Agent 的绑定，该 Agent 不再收到该渠道的消息。（verification：main 服务测试、Electron）
- AC6 — 未绑定任何渠道的 Agent 在应用内对话中正常工作。（verification：现有 Agent 测试套件）
- AC7 — 全局设置 > 渠道入口保持不变。（verification：renderer 测试）
- AC8 — 新增文案在所有已发布语言中都有翻译，且 i18n 检查通过。（verification：i18n 检查）

## Risks

- 从 Agent 对话框创建渠道与设置页使用同一创建路径，两者可能产生偏差。应保持只有一条代码路径。
- 从标签页创建的需凭据渠道在配置前保持未启用。用户可能把开关理解为「已连接」；未启用提示是缓解手段。
- 资源目录网格有自己的 Agent 菜单，不在本 Spec 范围内；如需支持，需另加 AC。
- 本 Spec 是在实现草稿之后编写的，而非之前。在本 Spec 的当前版本获得批准之前，实现 PR 不得标记为可评审。
- 部分被[智能体与助手的分页式编辑弹框](2026-11-12-resource-edit-pages.md)取代：智能体的频道页改为已绑定频道的列表，带完整配置，而不是每个平台一个开关。智能体列表菜单入口和保持不变的全局设置 > 频道仍然保留。
