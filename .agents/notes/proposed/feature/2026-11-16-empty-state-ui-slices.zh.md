# Agent Note: 空状态界面切片插画

Status: proposed

[English](2026-11-16-empty-state-ui-slices.md) | 中文

## Problem

共享组件 [`EmptyState`](../../../../packages/ui/src/components/composites/empty-state/index.tsx) 对所有空界面只画两种小线条插画之一（`inbox` 或 `book`）；它的 `preset` 属性已声明为无效。对渲染进程的盘点发现 183 处空状态调用点，分属三种互不相干的样式：42 处用线条插画，18 处只放一个图标，90 处只有灰色文字。这些插画既不说明界面会被什么内容填满，也不指出下一步在哪里，看起来像通用占位图，而不像 Cherry Studio 自己的界面。

一份本地设计稿重画了全部 47 个不同的空状态场景，并与产品负责人一起评审了九轮。写实物件（书架、铅笔、插头）、着色或软 3D 主体、每个场景一套配色、只有图标的方块都分别试过并被否决。最终认可的方向是截取真实产品界面的一角。它需要的颜色和层次是 [DESIGN.md](../../../../DESIGN.md) 目前对普通界面禁止的，因此需要一个明确且限定范围的例外，而不是一套未经评审的本地配色。

## Proposal

### 视觉约定

- 场景是空状态所在界面的一个裁切切片：真实布局（列表行、输入框、菜单、表格、网格）加上真实的本地化文字，画在中性语义表面上，带 1px 顶部受光描边和柔和投影。它通过径向边缘遮罩渐隐到容器里，而不是加一个边框。
- 每个场景只有一个点缀色，只标在下一步上：添加位、聚焦的输入框、悬停的行或主要控件。三颗像素块贴在切片边缘，用另外两种配色，属于个人资料产物空状态（[#24562](https://github.com/CherryHQ/cherry-studio/pull/24562)）同一家族的小格子图案。
- 不画写实小物件，不用着色或渐变的表面，一个场景里点缀色永远不超过一个。
- 动效只有三种：像素块缓慢漂浮、一个浮动元素（弹出框或被拖动的卡片）缓慢浮动、光标闪烁。在 `prefers-reduced-motion: reduce` 下全部停止。
- 场景是装饰性的：设为 `aria-hidden`，不可聚焦。标题、描述和操作仍是可访问的内容。

### 归属

- `@cherrystudio/ui` 在 `composites/empty-state/` 中、`EmptyState` 旁边提供与应用无关的基础组件：`EmptyStateScene` 外框（尺寸 `page | panel | sidebar`、点缀色和像素块的色板序号、边缘渐隐、像素块）以及切片构件（表面、标题栏、列表行、输入框、按钮、标签、虚线占位、开关、光标、鼠标指针、分隔线、占位条）。它们由 DOM 元素、Tailwind 语义工具类和 lucide 图标构成，所有文字都通过属性传入，不从 `@renderer` 导入任何内容。
- `EmptyState` 新增 `scene?: ReactNode` 属性，传入时替代线条插画渲染。不传时 `EmptyState` 与现在完全一致，未迁移的调用点继续使用 `inbox` 和 `book`。
- 每个具体场景是一个渲染进程组件，按[渲染进程架构](../../../../docs/dev/references/architecture/renderer.md)的路由规则 0 与其唯一使用方放在一起。它用 `t()` 翻译文字：含义相同时复用已有 key，否则在使用方的命名空间下新增 key。

### 插画色板

- 新增产品语义变量 `--illustration-1` 到 `--illustration-8`。域为 `illustration`，与 `chart-*` 一样按序号命名，不含色板名称。它们的取值在两种模式下都是原色天蓝、橙、翠绿、粉、琥珀、紫罗兰、青、玫瑰红的 500 档。
- 将它们登记到产品变量白名单和 Tailwind 颜色导出中，并扩展主题契约测试、[变量目录](../../../../packages/ui/docs/variable-catalog.md)和[设计 token 体系](../../../../packages/ui/docs/design-token-system.md)。
- 唯一的使用方是 `EmptyStateScene`。每个场景按序号显式选择点缀色和像素块颜色，没有自动轮换。
- DESIGN.md 新增一条限定范围的规则：装饰性空状态场景可以使用 `illustration-*` 角色、边缘渐隐和切片投影。这套色板不用于其他任何地方，场景的点缀色仍然只标在它的下一步上。

### 首批场景

本 Spec 覆盖六个代表场景。文案保持不变，只有目前没有文案的界面除外。

| 场景 | 使用方 | 改动 |
| --- | --- | --- |
| 暂无知识库 | `KnowledgePageEmptyStateSection` | 知识库面板，带点缀色的上传区和一个正被拖入的文件 |
| 未选择对话 | `ConversationCenterState`（首页对话和智能体对话） | 目前空分支渲染一块空白面板。改为对话列表切片（带一行悬停行）加标题和描述。首页对话通过现有的新建话题处理函数增加"新建对话"操作；智能体对话没有对应的处理函数，不显示操作。 |
| 未打开笔记 | `NotesEditor` | 无标题页面，带点缀色光标和斜杠命令菜单 |
| 暂无文件 / 无匹配 | `FilesPage` | 文件表格，带点缀色的拖放行 |
| 暂无小程序 / 搜索无结果 | `MiniAppsPage` | 启动器网格，带点缀色的添加格和添加网址弹出框 |
| 暂无通知 | `NotificationCenter` | 通知面板，带已读条目和点缀色的"全部已读"标签 |

### 交付

Spec PR 之后是叠加的实现层。第一层加入色板、DESIGN.md 规则、`@cherrystudio/ui` 基础组件和 `scene` 属性，并附带 stories 和测试。第二层迁移这六个场景。其余 41 个场景和六个紧凑模板在各自的 PR 中跟进。其他空白界面、`@cherrystudio/ui` 中硬编码的英文默认值以及已失效的 `preset` 属性另行处理。

## Alternatives considered

- **保留或扩展线条插画。** 给 `inbox` 和 `book` 增加更多变体，画的仍然是通用物件，也从不指出下一步。评审在几轮中都否决了写实物件。
- **像设计稿那样每个场景用 SVG 绘制。** SVG 文字不遵循应用的字体度量和换行，翻译后的文字只能估算宽度，内联颜色值也绕开了语义 token。DOM 组件保留了真实字体、主题切换和 token。
- **不放文字、用灰色线条代替。** 不需要 i18n key，但负责人选择了真实文字，因为正是它让切片看起来像当下的产品界面。
- **不改 DESIGN.md，点缀色用 `primary`，像素块用 `chart-*`。** 这会带回负责人否决过的绿色主题点缀色，也把数据分类角色挪作装饰。
- **只用中性色。** 符合现有规则，但被认为过于素。
- **着色主体、软 3D、每个场景三色配色、玻璃图标方块、细线图标中心。** 每种都做过原型，并在评审中以过时、杂乱或发糊为由被否决。
- **47 个场景放在一个 PR。** diff 太大无法评审，而且每个场景都依赖尚未评审的基础组件。

## Acceptance criteria

- AC1 — 传入 `scene` 的 `EmptyState` 渲染该场景而不是线条插画，场景为 `aria-hidden`，标题、描述和操作保持可访问且可操作 (verification: unit)
- AC2 — 不传 `scene` 的 `EmptyState` 渲染与之前一致，包括 `illustration="book"` 和图标覆盖 (verification: unit)
- AC3 — `--illustration-1` 到 `--illustration-8` 在浅色和深色模式下都能解析，已登记到产品白名单和 Tailwind 颜色，且 `pnpm --filter @cherrystudio/ui theme:check` 通过 (verification: unit)
- AC4 — DESIGN.md、变量目录和设计 token 体系文档说明了插画色板及其唯一允许的用途 (verification: docs gate)
- AC5 — 场景的像素块、浮动和光标正常播放动效，在 `prefers-reduced-motion: reduce` 下保持静止 (verification: Electron)
- AC6 — 知识库、笔记编辑器、文件（暂无文件和无匹配）、小程序（暂无小程序和搜索无结果）以及通知中心的空状态在浅色和深色主题下显示各自的场景，标题、描述和操作保持不变 (verification: Electron)
- AC7 — 首页对话在没有话题时显示对话中心场景、标题、描述以及通过现有处理函数创建话题的"新建对话"操作；智能体对话在没有会话时显示场景、标题和描述，不显示该操作 (verification: renderer)
- AC8 — 六个场景内绘制的所有文字都来自 i18n key，`i18n:check` 在所有语言下通过且没有占位文本，中文界面的场景内不出现英文界面用词 (verification: renderer)
- AC9 — 六个场景在各自的渲染尺寸下、中英文环境中都能放进容器，不被裁切也不溢出 (verification: Electron)

## Risks

- **视觉分量。** 场景比线条插画占更多画面。单一点缀色规则、中性表面和减少动效处理让它保持在标题和操作之后。
- **色板外溢。** `illustration-*` 工具类对任何组件都可用。DESIGN.md 规则和评审把它们限制在 `EmptyStateScene` 中。
- **翻译成本。** 每个场景都会在所有语言中新增几个 key。复用已有 key 控制数量，`i18n:check` 防止遗留占位文本。
- **与真实界面脱节。** 切片模仿它所在的界面，那个界面改版后切片可能过时。场景是示意性的，不要求逐像素一致；当它开始误导时再更新。
- **与 #24562 重叠。** 尚未合并的产物空状态自己绘制像素块。两者都合入后，它可以改用共享的像素块组件；二者互不阻塞。
