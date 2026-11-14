# Agent Note: 产品引导框架

Status: proposed

[English](2026-11-14-product-guide-framework.md) | 中文

## 问题

新版本改了默认值或挪了功能位置后，升级用户找不到原来的东西，也没有任何提示。渲染进程没有统一的一次性就地引导机制：各功能各自维护「已看过」标记（`ui.cherry_cloud.subscribe_prompt_seen`、`ui.cherry_cloud.model_guide`），订阅模型引导自己手写了聚光效果，还要把触发按钮的 ref 一路传进 `ChatConversationControls`。现在新增一个引导只能复制这个组件，也没有机制防止两个引导叠在一起，或者把「这里变了」的提示推给从没见过旧样子的新装用户。

## 提案

- **Coachmark 组件。** 在 `@cherrystudio/ui` 里新增 `Coachmark` 组合组件：压暗窗口，只在目标周围留出带内边距的亮区，并把弹出卡片与亮区对齐。点卡片按钮、点外部、点目标本身或按 Escape 都会关闭。字号使用共享正文字号，浅色和深色主题都适配。
- **登记表。** 渲染进程用一个模块登记所有引导：`id`、起始版本 `since`、受众 `audience`（`upgraded` 或 `everyone`）、锚点 key 和文案 key。目标元素用 `data-guide-anchor="<key>"` 属性标记，不再通过 props 传递 ref。
- **调度。** 主窗口同一时间最多显示一个引导，并且只在以下条件都满足时显示：锚点在当前活动标签页上可见、没有强制关卡在显示（`useMandatoryGateOpen`）、没有其他对话框打开。看过的引导 id 存在渲染进程持久缓存 `ui.product_guide.seen` 里，每个引导只显示一次。
- **受众。** `upgraded` 引导只给运行过早于 `since` 版本的用户看。首次运行时，渲染进程写入 `ui.product_guide.baseline_version`：取现有 `version.log` 里的上一个应用版本（`VersionService.getPreviousVersion`），新装用户则取当前版本。引导的 `since` 比基线新时才有资格显示。上一个版本通过一个只读的 IpcApi 路由传给渲染进程，主进程不新增任何记录。
- **范围。** 需要用户做选择的功能弹窗（例如套餐开通弹窗）仍由各功能自己负责，框架只管锚定在元素上的一次性引导。功能可以主动请求显示一个已登记的引导，例如订阅流程在弹窗关闭后请求模型按钮引导。
- **迁移。** 订阅开通引导（#24425）合并后，把对话顶部的模型引导迁到框架上：`ui.cherry_cloud.model_guide` 只保留待切换的模型选择，`ChatConversationControls` 去掉 `modelTriggerRef` prop。
- **仓库 Skill。** `.agents/skills/product-guide/` 告诉 agent 在改了默认值、挪了入口，或者上线了用户不容易发现的功能时怎么做：按清单判断是否需要引导；登记引导；按规则写文案（简短、不出现套餐或档位名、使用共享字号）；添加 `en-us` 文案并翻译全部语言；编写契约测试（只显示一次、`upgraded` 引导不给新装用户看、遇到关卡会等待）；在 Electron 里用浅色和深色截图验证，并测量卡片与亮区是否对齐。

## 考虑过的替代方案

- 使用 react-joyride 或 driver.js 这类导览库：会引入一个自带样式和层级模型的依赖，而实际需求只是同一时间一个锚定提示，并且要遵循 `@cherrystudio/ui` 的设计变量和现有的强制关卡。
- 把「已看过」状态存在 Preference 里：可以跨窗口同步、清缓存后也不丢，但引导状态属于可丢失的界面状态，Preference 只用于用户设置。
- 新增持久化的「首次安装版本」记录：`version.log` 已经记录了每次版本变化，读一次上一个版本就足以确定基线。
- 只写 Skill、不做共享代码：agent 每次都会复制订阅引导，重复出现对齐和叠加问题。

## 验收标准

- AC1 — 已登记的 `everyone` 引导在锚点出现在主窗口活动标签页上时显示一次；通过任意一种方式关闭后（点按钮、点外部、点目标、按 Escape）都不会再出现。(verification: renderer)
- AC2 — 基线版本早于 `since` 的用户能看到 `upgraded` 引导；在 `since` 及之后版本新装的用户永远看不到。(verification: renderer)
- AC3 — 强制关卡或其他引导正在显示时，到期的引导会等待，关闭后再显示；任何时候最多只显示一个引导。(verification: renderer)
- AC4 — Coachmark 的弹出卡片与亮区对齐，只使用共享正文字号，浅色和深色主题下都清晰可读。(verification: Electron)
- AC5 — 订阅模型引导运行在框架上，行为不变；`ChatConversationControls` 不再接收触发按钮的 ref。(verification: renderer + Electron)
- AC6 — `.agents/skills/product-guide/SKILL.md` 已加入 `public-skills.txt`，通过 `pnpm skills:check`，并写明判断清单、登记方式、文案规则、多语言、测试和 Electron 验证步骤。(verification: CI gate)

## 风险

- 清除渲染进程存储会重置「已看过」状态，并按上一个版本重新计算基线，用户可能再次看到近期的引导。
- 引导依赖锚点一直挂载；锚点改名或被删除会让引导悄悄失效，因此 Skill 要求每个锚点都有测试。
- AC5 依赖 #24425 先合并；在那之前订阅引导保留自己的实现。
