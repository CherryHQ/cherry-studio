# Agent Note: 统一选区引用与网页标注

Status: proposed

[English](2026-09-20-unify-selection-reference-and-webview-annotation.md) | 中文

## Problem

同一个用户动作——*在某个界面上挑一个单元，交给 agent*——被做了两遍，两套实现之间没有任何
共享代码。两个开关还挂在同一个 agent 右侧面板的相邻 capability 上（`files` 在
`src/renderer/pages/agents/components/AgentRightPane/AgentRightPane.tsx:1536`,`browser` 在
`:1520`），用户切一个 tab 就会同时见到它们。

| 接缝 | 选区引用（files） | 网页标注（browser,#17842 / `128a3a19cb`） |
|---|---|---|
| 开关 | `SquareDashedMousePointer`,`ArtifactPane.tsx:467-487` | `MousePointer2`,`WebviewAnnotationControls.tsx:126-145` |
| 文案 | `agent.preview_pane.pick_selection` — "Select region" / "选区"（`en-us.json:150`、`zh-cn.json:150`） | `webview.annotation.enable_mode` — "Annotate page" / "标注页面"（`en-us.json:5699`、`zh-cn.json:5699`） |
| 高亮 | renderer 里的 React + Tailwind | guest shadow root 内的 CSS，主色硬编码在 `src/preload/WebviewAnnotationController.ts:635`（`#818cf8` / `#4f46e5`），由 `:52-87` 消费 |
| 事件 | `INSERT_COMPOSER_SELECTION_REFERENCE`（`AgentRightPane.tsx:921-930`） | `INSERT_AGENT_COMPOSER_TOKEN`（`:983-1001`） |
| token kind | `reference`（`selectionReferenceToken.ts:36-43`） | `webviewAnnotation`（`AgentRightPane.tsx:995`） |
| 载荷 | 结构化 anchor + `excerpt` + `fileStamp`（`src/renderer/types/selectionReference.ts:103-128`） | CSS selector + 可选 `region {rect, elements}` + **必填** `comment`（`src/shared/types/webviewAnnotation.ts:31-81`,`min(1)` 在 `:77`） |
| prompt 编码 | 机器可解析的 `selection-ref` 围栏 JSON（`selectionReferenceToken.ts:42`） | Markdown 散文，`## User annotation request` + `## Untrusted page reference data`（`src/shared/utils/webviewAnnotations.ts:77`） |
| 消费方 | `resources/skills/office-transform/SKILL.md:30-36`，直接把 `anchor` 喂给 `--anchor` | 只有模型 |
| 长度守卫 | 插入前强制检查，不够就用 `chat.input.reference_panel.no_room_selection` 拒绝（`useComposerSelectionReferenceInsertion.ts:42-48`） | 没有——`AgentComposer.tsx:1111-1120` 直接调 `insertToken` |

整体上存在三套寻址词汇：文档 anchor（`selectionReference.ts:103-108`，明确写着"never DOM or
pixel coordinates",`:5-13`）、CSS selector（`webviewAnnotation.ts:31-41`），以及 browser-use 那套
一次性的 `eN` ref（`src/main/ai/mcp/browserToolDefinitions.ts:5`,"Refs expire on navigation",
`:68`），底层是 `backendNodeId`（`src/main/features/browser/browserUse.ts:10-12`）。设计文档已经点名
其中两套需要调和（`docs/references/ai/browser-use-design.md:191-199`）。

## Proposal

分四层，每层都能独立发版。第 1-3 层只动交接方式，两个拾取引擎保持分离。

### Layer 1 — 视觉对齐（PR-A，已在路上）

两个开关用同一个图标；guest 浮层的 `--annotation-accent` 改为取自 app primary，不再用
`WebviewAnnotationController.ts:635` 那对硬编码色值，并采用与 renderer 拾取器相同的 hover（40%）/
active（100%）权重。这一层不动文案。

### Layer 2 — 一条交接路径

给 `DocumentAnchor`（`selectionReference.ts:103-108`）加一个 `web` 变体：

```ts
{ format: 'web', url, selector, region?: { rect, elements } }
```

`excerpt` 就是该元素（或该区域）的文本。相邻还有两个字段是"文件形状"的，必须一起泛化：`path` 是
`AbsoluteFilePathSchema`（`:123`）,`fileStamp` 是 `{size, mtimeMs}`（`:113-118`）。把两者换成一个
可判别的 `source`:`{ kind: 'file', path, stamp } | { kind: 'page', url, title, capturedAt }`。
网页这边没有新鲜度检查（`office-transform/SKILL.md:38-53`）的对应物，页面戳记正是它的替代；记下来
总比假装页面不会变要划算。

把它当作 `reference` token 经 `INSERT_COMPOSER_SELECTION_REFERENCE` 发出，走
`useComposerSelectionReferenceInsertion.ts:42-48` 这一个长度守卫，用同一种 prompt 编码——即
`selection-ref` 围栏 JSON，并把标注 prompt 今天携带的那条不可信数据提示
（`webviewAnnotations.ts:3-4`）作为围栏外的同级一行一并带上。

此后 `webviewAnnotation` 不再被*生产*为一种 token kind，但**必须仍可读取**。这个 kind 位于一个
被持久化的 enum 里（`src/shared/data/types/uiParts.ts:261-271`），经用户 `TextUIPart` 的
`providerMetadata.cherry.composer` 到达（`:164`），而这份 meta 是用 `safeParse` 读的，失败就返回
`undefined`（`:451-455`）——删掉该枚举值会静默丢弃每一条含标注 chip 的历史消息的*整个* composer
快照，而不只是那一个 chip。**因此要的是读兼容垫片，而不是数据迁移**:把 `webviewAnnotation` 留在
enum 里并标注为 legacy-read-only，只从 `composerTokenPolicy.ts:18-29` 的生产集合中移除。不需要重写
任何行，因为这类 token 的 `messageText: true`（`:27`）——它们的 prompt 文本早已内联进持久化的消息
正文，不依赖 chip 本身。

### Layer 3 — 一个动作

把 `comment` 改为可选（`webviewAnnotation.ts:77`，以及 `WebviewAnnotationControls.tsx:228` 那个
草稿为空即禁用保存的按钮）。空内容保存得到一条纯引用（citation），填了内容则得到今天的标注。

备注作为一个可选的 `note` 字段随 **reference 载荷**走在围栏 JSON 内部，而不是放进输入框文本。一旦
用户插入第二条引用，输入框文本就与它的 anchor 脱钩，解析围栏的 skill 只能猜哪段散文属于哪个
anchor;而 `formatAgentWebviewAnnotationPrompt` 今天本就把 comment 绑在 element 上。代价是 `note`
不能再靠在输入框里重打来修改——这由 chip 既有的可重新打开的编辑器兜底。

之后两个开关共用 "Select region" / "选区" 这一个文案，"Annotate page" / "标注页面" 则退化为对"可选
备注"这一步的描述，不再是一个模式的名字。

### Layer 4 — 刻意不动

两个拾取引擎保持分离：一个是 renderer 里的 React，跑在 FilePreview 插件的 view → structure 逆映射
之上（`src/renderer/components/FilePreview/README.md:201-212`）;另一个是 guest 隔离世界里的
hover/marquee 浮层。browser-use 的 `eN` ref 与 P3 的 `backendNodeId` 映射仍属 agent → page 一侧，
不受影响。

### Rollout

| PR | 内容 | 粗略体量 |
|---|---|---|
| PR-A（进行中） | Layer 1 视觉对齐 | 小 |
| PR-B | schema 中的 `source` + `web` anchor、页面戳记、`formatAnchorLabel` 的 `web` 分支 | 中 |
| PR-C | browser 面板改发 `reference` 走 `INSERT_COMPOSER_SELECTION_REFERENCE`;`webviewAnnotation` 转为 legacy-read-only | 中 |
| PR-D | 可选 comment、`note` 字段、共用文案 | 小 |

之后 `docs/references/ai/browser-use-design.md` 的 P3（`:342-343`）应当补上一段——由该文档的
owner 来加，不由本 note 代劳：

> The human → agent hand-off is a single `reference` token carrying a `web` `DocumentAnchor`
> （`url` + `selector` + optional `region`）, so P3's locator work has one inbound shape to map. The
> annotation-target handoff contract is therefore the selector → `backendNodeId` resolution for that
> anchor plus its document identifier; the token schema itself needs no further additions.

## Why the comment is mandatory today

没有任何成文理由——#17842 里没有，`browser-use-design.md:167-199` 里没有，代码注释里也没有。能观察
到的只是：这个功能被建模成**钉在元素上的评审意见**——占位文案是 "Describe what should change or
what you noticed…"（`WebviewAnnotationControls.tsx:190`）,prompt 标题是 `## User annotation
request`(`webviewAnnotations.ts:77`),剪贴板导出按 `### N. Annotation` 编号
（`src/main/services/webview/annotationMarkdown.ts:92`，只在复制路径上被调用，
`useWebviewAnnotationSession.ts:574-581`）。元素是*在哪*,comment 是*要什么*。

选区引用则被建模成**引文**:*在哪*就是载荷的全部，意图留在用户围着 chip 打的那段输入框文本里。

建议：把 comment 改为可选，留空即引用。本 note 不回避反方意见：没有意图的标注对模型而言是噪音，把
两个动作区分开——引用 vs 标注——能让用户清楚自己在做哪一件事。回应是：这个区分以 `note` 的有无继续
存在，而模型无论如何都会收到输入框文本。

## Alternatives considered

- **保持分离，只对齐视觉（只做 Layer 1）。** 作为终点被拒绝，但作为第一个 PR 成立：它消除了肉眼可见
  的不一致，却把两种 token kind、两个事件、两种长度守卫行为留给之后每一个消费方去学。
- **只统一 prompt 编码。** 拒绝：不统一载荷就把标注 prompt 改写成 `selection-ref` JSON，只会产出一个
  `anchor` 没人能用的围栏，而且 `webviewAnnotation` 仍留在持久化 enum 里且再无区分度。
- **让标注成为超集，废弃选区引用。** 拒绝：标注载荷按 DOM 寻址，而 `selectionReference.ts:5-13` 正是
  有意排除这一点，因为 DOM 坐标会随渲染实现漂移；office-transform 的 anchor 检查与新鲜度检查
  （`SKILL.md:38-64`）也没有 selector 版本。
- **连拾取引擎一起统一。** 拒绝：一个跑在 renderer、面向插件的结构模型，另一个跑在 guest 隔离世界、
  走 session 作用域的 bridge，还有"每个 guest 只能有一个 debugger 会话"的硬约束
  （`browser-use-design.md:183-190`）。它们共享的是载荷，不是运行时。

## Acceptance criteria

- `DocumentAnchor` 接受 `format: 'web'`;`source` 能判别 file 与 page;既有 xlsx / docx / pdf / pptx
  引用解析行为不变。
- browser 面板经 `INSERT_COMPOSER_SELECTION_REFERENCE` 发出 `reference`，并受同一个长度守卫约束；
  没有任何调用点再发 `kind: 'webviewAnnotation'`。
- 改动后，含 `webviewAnnotation` token 的历史消息仍能完整渲染其 composer 快照（针对
  `uiParts.ts:451-455` 的回归测试）。
- 空 comment 保存产出引用 chip;填了内容则产出同一个 chip 外加 `note`。
- `office-transform` 对 `web` anchor 明确说明理由后拒绝，而不是把它传给 `--anchor`。

## Risks

- **持久化 token 的兼容性。** `safeParse` 返回 `undefined` 是静默失败，所以垫片必须和"停止生产该
  kind"的那个 PR 同批落地并带测试，否则历史消息会无声无息地丢 chip。
- **skill 被打断。** `office-transform/SKILL.md:36` 把 `anchor` 直接交给 `--anchor`。只认四种格式的
  脚本收到 `web` anchor 时必须显式拒绝，或者由某个 browser skill 来认领它。
- **不可信数据提示必须活着搬过去。** 它今天写在 Markdown 散文里（`webviewAnnotations.ts:3-4`）;挪进
  JSON 围栏后必须留在围栏之外，才能继续被模型当作指令而不是数据读。
- **region 在文档 anchor 里没有对应物。** `region {rect, elements}` 是页面像素几何，恰是
  `selectionReference.ts:5-13` 为文档排除掉的那类坐标。它只在 `format: 'web'` 下被接纳——那里像素本
  就是页面自己的词汇——这条排除对其余所有格式依然生效。
- **excerpt 预算。** `SELECTION_EXCERPT_MAX_LENGTH` 是 2000（`selectionReference.ts:120`）;最多 12 个
  元素的 region（`webviewAnnotation.ts:12`）可能超出，此时应截断而不是拒绝。
