# T-006E 源段落高亮

**状态**：✅ 已完成（2026-05-23 视觉验证 + cleanup 计数验证全通过；2026-05-26 paint/clear 链获得真实测试覆盖 + 删除 dangling `data-branch-anchored` 属性，入库 commit `f3bf0dbf7`；2026-05-31 mutation/red-test 验证 + 修补 1 个新发现的 fake-green（unmount cleanup → deps-change cleanup），待 commit）
**依赖**：T-006D-2B S6'（branch anchor 携带 `blockId` + `selectionStart/End`）
**实际工作量**：远超 1 天 —— D-010 → D-011 → D-012 → D-013 四轮失败 + 切换实现层后又修一轮 cleanup 泄漏 + 一轮测试覆盖重写 + 一轮 mutation 验证 + fake-green 修补。**完整决策链见 [[问题与Debug记录]] D-010~D-013-CLOSED + [[开发日志]] 2026-05-23 / 2026-05-26 / 2026-05-31 三个条目**。

---

## 这份文档以前写错了什么

旧版 README 描述的方案 **全部已被推翻、不再适用**，包括：

| 旧 README 写的 | 现实 |
|---|---|
| `range.surroundContents(<mark class="branch-anchor-hl">)` | ❌ `surroundContents` 跨元素边界（穿过 markdown 的 `<strong>`/`<em>`/`<code>`）会抛 `INVALID_STATE_ERR` |
| "跨段落不支持" 是 v1.0 接受的限制 | ❌ 实际选区**经常**跨节点（一段加粗 + 普通 + 链接），不支持就等于不可用 |
| "v1.1 升级到 CSS Custom Highlight API" | ❌ 实测在本 Electron/Chromium + markdown DOM 环境下**完全不出像素**（Range/Highlight 注册都正确，零渲染），已弃 |

**不要再按旧 README 重试这两条路。** 见下方「决策史」。

---

## 实际实现（v1.0 / 当前生产）

### 数据流

```
SelectionContextMenu (右键 "Open as branch")
  ↓
captureSelectionOffsets(range) → { start, end }      （字符偏移，相对 block 文本）
  +
findBlockContext(range) → { messageId, blockId, role }
  ↓
buildAnchor() → BranchAnchor { messageId, blockId, selectedText, selectionStart, selectionEnd }
  ↓
onOpenBranchPanel → onOpenBranchAnchor → setBranchAnchor(anchor)   (Chat.tsx)
  ↓
useMemo branchAnchorHighlight: { highlightedBlockId, selectionStart, selectionEnd }
  ↓
<BranchAnchorContext value={...}>  包  <Messages>
  ↓
MainTextBlock 内 use(BranchAnchorContext) 读出 highlightedBlockId 对比 block.id
  ↓
isBranchAnchored=true  → useEffect 调用 paintSourceHighlight(el, start, end)
  ↓
resolveBranchHighlightRange(blockEl, start, end) → Range
  ↓
wrapRangeWithSpans(blockEl, range) → 跨节点 <span class="branch-anchor-highlight"> 包裹
```

### 关键文件

| 文件 | 角色 |
|---|---|
| `src/renderer/src/context/BranchAnchorContext.tsx` | Context 单例（`globalThis.__BRANCH_ANCHOR_CTX_CACHE__ ??= ...`，HMR-safe）+ `useBranchAnchorHighlight()` hook |
| `src/renderer/src/utils/branchAnchor/sourceHighlight.ts` | `captureSelectionOffsets` / `resolveBranchHighlightRange` / `paintSourceHighlight` / `clearSourceHighlight` —— 共享 `flattenTextNodes` 坐标系 |
| `src/renderer/src/utils/branchAnchor/findBlockContext.ts` | 从 Selection Range 找到带 `data-block-id` 的祖先元素 |
| `src/renderer/src/components/SelectionContextMenu.tsx` | 捕获 selectedText + offsets，build anchor，触发 host callback |
| `src/renderer/src/pages/home/Messages/Blocks/MainTextBlock.tsx` | Provider consumer + `useEffect` 调 paint/clear；DOM 上 `data-block-id={block.id}` |
| `src/renderer/src/pages/home/Chat.tsx` | 顶级 state holder；包 `<BranchAnchorContext>` provider；`onComposeCancel` 关闭路径调 `clearSourceHighlight()` |

### 跨节点 wrap 算法

`wrapRangeWithSpans(blockEl, range)`：

1. `flattenTextNodes(blockEl)` 取 block 内所有 Text 节点（doc order）
2. 用 `range.startContainer/endContainer` 的 indexOf 在数组里定位 in-range 切片
3. 对切片每个 Text 节点：
   - 算这个节点内的 `[s, e)` 子区间：`s = (tn===startNode ? range.startOffset : 0)`，`e = (tn===endNode ? range.endOffset : tn.length)`
   - 如果 `s > 0`：`target = tn.splitText(s)` 剥出后半段，更新 `e -= s`
   - 如果 `e < target.length`：`target.splitText(e)` 切掉尾段（被丢弃，留在 DOM 但作为独立 Text 节点）
   - `parent.insertBefore(<span>, target) + span.appendChild(target)` —— span 包裹 in-range 子串
4. 返回所有创建的 span 数组

**为什么不用 `range.surroundContents`**：跨 markdown 元素边界（典型如选区从普通文本进入 `<strong>`）会抛 `INVALID_STATE_ERR`。我们的算法专门处理这种情况 —— 每个 Text 节点单独 wrap，保留原父级标签结构（`<strong>` 内的高亮文字仍在 `<strong>` 里）。

### 清除 (`clearSourceHighlight`)

**字节级 DOM 复原 + idempotent + 全局**：

```ts
const spans = document.querySelectorAll(`span.${WRAP_CLASS}`)
if (spans.length === 0) return
const parents = new Set<Element>()
spans.forEach((span) => {
  const parent = span.parentNode
  if (parent === null) return
  const children = Array.from(span.childNodes)
  span.replaceWith(...children)
  if (parent instanceof Element) parents.add(parent)
})
parents.forEach((p) => p.normalize())
```

要点：
- `document.querySelectorAll` 全文搜，**永不**依赖存储的 span 引用（React reconciliation 会让旧引用失效，这就是 leak 的根因）
- `Element.replaceWith(...children)` 单原子 DOM 原语 —— 同时移除 span 元素与插入其子节点；空 span 走 `replaceWith()`（零参）= 单纯移除。**不会**有「孩子搬走但 shell 残留」的中间状态
- `parent.normalize()` 合并 `splitText` 创建的相邻 Text 节点，DOM 字节级复原

**调用点**：
1. `paintSourceHighlight` 体内**首行**调一次 —— 切换 anchor 时新 paint 必先清旧 → 任意时刻只有当前 anchor 的 span（idempotent，不累积）
2. `Chat.tsx` 的 `onComposeCancel` 关闭路径**显式调一次** —— 关闭 Branch Panel 同步清干净（同时 setBranchAnchor(null) + setBranchTopic(null) + branchFork.reset()）

### 样式

```css
span.branch-anchor-highlight {
  background-color: rgb(251 191 36 / 0.45);  /* amber-400 @ 45%，concrete 值不用 CSS var */
}
```

color 不用 `var(--color-warning-bg)` —— 那是 amber-50 ≈ 3% 黑叠加在白底文字上几乎不可见（D-010 教训）；同时 `var()` 在某些 CSS pseudo 上下文里解析不稳（CSS Custom Highlight API 上踩过）。直接写 concrete 值。

### 坐标系不变量

`captureSelectionOffsets`（用户选中时算偏移）与 `resolveBranchHighlightRange`（paint 时重建 Range）**共用同一个 `flattenTextNodes` 函数**作为「block 内字符索引」的定义。这是 D-012 那一轮被怀疑过的 capture vs paint 漂移 —— 强行用同一段代码定义坐标系是结构性消除漂移的办法。**任何修改 capture 或 resolve 必须同步审查另一侧。**

---

## 决策史（D-010 → D-013-CLOSED）

每一步的真实原因 + 推翻原因。**这一段的目的是阻止后人重试已被推翻的方案。**

### D-010：第一次「颜色不对」
- **方案**：`block.id === highlightedBlockId` 时，给 MainTextBlock 的 wrapper div 加 `bg-accent/60` className
- **现象**：选中后看不见任何颜色变化
- **根因**：`accent` 是 DESIGN.md 的中性近透明 token（≈3% 黑叠加），白底上肉眼几乎不可见
- **修**：换 `warning` 色族（暖琥珀）—— 颜色解决了

### D-011：「不是颜色对错，是范围错了」
- **现象**：颜色换暖琥珀后，**整条助手回复**被高亮，而不是只高亮选中的那一段
- **根因**：本项目里一整条助手回复 = **单一 MAIN_TEXT block**（`Blocks/index.tsx:193-194` 把 MAIN_TEXT/CODE/UNKNOWN 都路由到 MainTextBlock）。block 级别高亮等于整段亮
- **修**：放弃 block 级 className，改实现精确字符范围高亮。引入 `BranchAnchor.selectionStart/End` 字段，写 `captureSelectionOffsets` + `resolveBranchHighlightRange` + 基于 **CSS Custom Highlight API**（`CSS.highlights` + `Highlight` + `::highlight()`）的画法

### D-012：「精确高亮也不显示」
- **现象**：CSS Highlight API 注册成功（`CSS.highlights.has(name) === true`），但页面零渲染
- **怀疑（A）**：offsets 漂移（capture 用 `Range.toString().length`，rebuild 用 text-node 累加 length —— 两条遍历可能在跨节点 markdown DOM 上不等）
- **怀疑（B）**：颜色不可见（`::highlight()` 用 `var(--color-warning-bg)` —— amber-50 太淡 + `var()` 在 highlight pseudo 内解析不可靠）
- **加固**：①两侧统一改用 `flattenTextNodes`（消除 A）；②颜色换 concrete `rgb(251 191 36 / 0.45)`（消除 B）；③加 rAF 兜底重绘
- **结果**：仍不显示。进入 D-013 instrumentation 阶段

### D-013：盲修循环 → 全路径 trace
- 三轮 blind-fix 全部失败后，用户停下，要求**只加 instrumentation 不再猜**
- 5 阶段 reader 端日志（`[S6 trace] effect fired / block element / range resolve / paint called / CSS.highlights state`）
- trace 回报：`effect fired` 全部 `highlightedBlockId: null, matched: false`
- 一系列误诊（双 source / Provider 错位 / id 漂移 / HMR context 分裂）逐个被自身后续 trace 推翻 —— 见 [[问题与Debug记录]] D-013 / D-013-FIX-DISPROVEN
- 关键节点 `D-013-PIPELINE-OK`：用户加上 `insideProvider` 判别器 + 定向比对后实测：**选中块** `insideProvider:true / matched:true / earlyReturn:null / highlightedBlockId 一致 / start:1440 / end:1550`。整条 wiring 走通
- 残留唯一失效点：`paintSourceHighlight` 体内 `paint detail` trace 显示 `rangeResolved:true / rangeText 与选中段精确一致 / startContainer endContainer 都是 #text / afterSet.has:true / size:1` —— **Range 完美、Highlight 已注册，却零像素**
- **结论**：CSS Custom Highlight API 在本 Electron/Chromium + markdown DOM 环境下不出像。**不再调试这条 API**，触发既定 stop-loss

### D-013-FIX-FINAL：切换到 `<span>` wrap
- 保留 capture / resolve / context wiring（trace 已证全部正确）
- 只换最终 paint：`new Highlight(range)` + `CSS.highlights.set()` → `wrapRangeWithSpans(blockEl, range)` 跨节点 `<span>` 包裹
- 视觉验证通过：`spanCount:2`、暖琥珀位置正确

### D-013-HARDEN：cleanup 泄漏修
- 切换后 `spanCount` 在 anchor 切换时**不**累积 ✓（paint 体内首行 `clearSourceHighlight()`）
- 但 DOM 里看到两类残留：
  - `<strong><span class="branch-anchor-highlight">深度学习框架，构建AI模型。</span></strong>` —— **完整未被清的旧 span**
  - `<span class="branch-anchor-highlight"></span>` —— **空 shell**（子节点搬走但 span 元素留了）
- 根因：旧 `clearSourceHighlight` 走 `while (span.firstChild) parent.insertBefore + parent.removeChild(span)` 两步操作 —— React reconciliation 在两步之间动 DOM 时 `removeChild` 可能 fall through / `parent.parentNode` 错位，结果 shell 残留；某些情况下 cleanup 根本没跑（cleanup 时点 + React commit 时点错开）
- **修**：`clearSourceHighlight` 改用单原子原语 `span.replaceWith(...Array.from(span.childNodes))`，无中间状态；全文 `document.querySelectorAll` 全局擦不依赖存储引用
- 验证：baseline 0 → 开 A → 5 → 切 B → 3（不是 8，没累积）→ 关闭 Branch Panel → 0 → 空 span 也 0 → 反复 open/switch/close 5-6 轮 → 永远在 close 时回 0

### 不要再走的弯路（red list）

| 方案 | 推翻原因 |
|---|---|
| `range.surroundContents(<mark>)` | 跨元素边界抛 INVALID_STATE_ERR；markdown 选区**几乎总是**跨边界 |
| block 级 className 高亮 | 整段亮，不是精确范围 —— 因为 1 reply = 1 MAIN_TEXT block |
| `accent` / `bg-accent/*` token | DESIGN.md `accent` 是近透明中性色，白底不可见 |
| `var(--color-warning-bg)` （amber-50）@ `::highlight()` pseudo | amber-50 太淡 + `var()` 在 highlight pseudo 上不稳 |
| CSS Custom Highlight API (`CSS.highlights` + `Highlight`) | 本 Electron/Chromium + markdown DOM 环境零渲染（trace 确认 Range/Highlight 都注册成功） |
| 把 `BranchAnchorContext` 当作普通模块导出 | 非 React 组件、不 Fast-Refresh-eligible，多次编辑致 Vite 重新执行 → 新 createContext 对象 → Provider/consumer 分裂；现已 globalThis 单例化 |
| 旧 `clearSourceHighlight`（insertBefore loop + removeChild 两步）| 两步操作 race；改 `Element.replaceWith` 单原子原语 |

---

## 已知限制（v1.0 接受）

- **切 topic 离开再回来高亮不恢复** —— anchor 不持久化（只活在 Chat.tsx 的 useState 里）。`<style id="branch-anchor-highlight-style">` 标签会留在 `<head>`，但无 span 可作用。**这是 anchor 持久化的范畴**，要做需要新设计：见 [[设计.md]] §4 + [[T-006D_BranchPanel/T-006D-2_RealFork|D-2]] 的 anchor 持久化 backlog
- **关闭 Branch Panel 不删 SQLite topic 行** —— 关闭只清前端 state（`setBranchAnchor(null) + setBranchTopic(null) + branchFork.reset() + clearSourceHighlight()`），不调 `DELETE /topics/:id`。已创建的 branch topic 留在 SQLite 表里。归 **path Y / delete-on-close** 子任务（[[T-006D_BranchPanel/T-006D-2_RealFork/preflight.md]] T-006D-2C-5 cleanup 一并处理）
- **流式中不能开分支** —— `block.status !== 'success'` 时 SelectionContextMenu 的 "Open as branch" 已 disabled。本任务不变
- **Markdown 重渲会丢高亮**（理论风险）—— 实测下源助手消息完成态、`block.content` 稳定 → ReactMarkdown 对账同 vnode → React 不动 DOM，span 留存；effect deps 含 `block.content` —— 若 content 真变 effect 重跑、自动重 wrap。**未实测必须加 `MutationObserver` 兜底的场景**

---

## 验收（已通过 2026-05-23）

- [x] 选中文字 → 右键 → "Open as branch" → 选区获得 amber 高亮（concrete `rgb(251 191 36 / 0.45)`）
- [x] 选区跨 `<strong>` / `<em>` / `<a>` / `<code>` 边界时正常高亮，多 span 包裹工作；父级 markdown 样式（粗体、链接 href、代码字体）继承不变
- [x] copy 高亮文字 → 粘贴出 = 选中原文，无多余空格 / 无缺字
- [x] 切 anchor A → B（不关 panel 直接选另一段开新分支）：A 的 span 全清，仅 B 的 span 存在；DOM 里 `span.branch-anchor-highlight` count 不累积
- [x] 关闭 Branch Panel（X 按钮，compose 与 conversation 两态都能点）→ span count 回 0；DOM 字节级复原
- [x] **空 shell 残留检查**：`[...document.querySelectorAll('span.branch-anchor-highlight')].filter(s => !s.textContent).length === 0` 在每个状态下都为 0
- [x] 反复 open/switch/close 5-6 轮 —— count 在 close 时永远回 0、永无 shell

---

## 测试覆盖（2026-05-26 补充）

历史教训：原 MainTextBlock 4 个高亮用例只断言 `data-branch-anchored` 属性 —— 这个属性既不参与渲染也无 CSS 规则也无 querySelector 消费者，纯粹是测试自己写自己看。13 轮 D-013 debug 期间这套测试全程通过却没暴露任何高亮失效。本轮把测试改成断言**真实可见行为**。

**SCOPE 约束（写在两个测试文件顶部的注释里）**：jsdom 没有 layout 或 paint 引擎 → 这些测试守护 **DOM 突变链**（span 正确注入、清扫时字节级复原），**不**守护视觉可见性。绿色 build 不等于用户能看见琥珀色 —— 视觉可见仍须人工 / 浏览器验证。

| 测试文件 | 覆盖 | 用例数 |
|---|---|---|
| `src/renderer/src/utils/branchAnchor/__tests__/sourceHighlight.test.ts` | 1. `captureSelectionOffsets ↔ resolveBranchHighlightRange` round-trip（结构无关 paint，本来就有效） | 9 |
|   | 2. `paintSourceHighlight + clearSourceHighlight` DOM 突变链：单节点 span 文本对齐 / 跨节点 ≥ 2 span + 拼接对齐 / clear 后 spans=0 + textContent 字节级复原 + childNodes 恢复连续 / idempotent clear / A→B 切换不累积 / 5 轮 open/clear 循环不累积 | 6 |
| `src/renderer/src/pages/home/Messages/Blocks/__tests__/MainTextBlock.test.tsx` 的 `branch-anchor highlight (S6 paint chain)` 块 | context-match → effect-fires → span-injection wiring：无 Provider 不注入 / context 匹配本块时 span 注入 / context 指向他块时本块不注入 / 多块同存时只匹配块有 span / **anchor context 翻 non-matching 时 effect cleanup 清扫 spans（deps-change cleanup，**非** unmount）** | 5 |

**测试分层原因**：MainTextBlock 把 `<Markdown>` mock 成一个占位 `<div>`，DOM 结构简化 → 适合验证 wiring，不适合验证跨节点 span 文本拼接；sourceHighlight 用手搓 fixture（`<strong>` 嵌套、纯文本、列表）→ 适合验证 DOM 突变细节。两层都用 `resolveBranchHighlightRange` 经过 offset → range 路径构建测试 Range，**不**用 `window.getSelection()`（jsdom Selection 支持不可靠，offset 路径也是生产 `paintSourceHighlight` 真正走的）。

---

## Mutation/red-test 验证（2026-05-31 补充）

P0 的 36 个绿色用例本身只是必要条件 —— "测试通过" 不等于 "测试在守护真实行为"（13 轮 D-013 debug 全程绿，正是这个等式不成立的活体证据）。本轮做一次性 mutation 验证来填补这个缺口：临时把实现做成 no-op，看应红的用例是否真红。

| Mutation | 范围 | 期望 RED | 实际 RED | 结论 |
|---|---|---|---|---|
| Mutation 1 | `paintSourceHighlight` body 顶部加 `return`（no-op） | sourceHighlight 5 个 paint/clear 用例 + MainTextBlock 3 个高亮用例 | sourceHighlight 5 ✓ + MainTextBlock 3 ✓ + sourceHighlight `clear removes spans...` 也红（test 内部 paint 失败级联）= 8 RED | 全部 expected-red 都红，无假绿 |
| Mutation 2（首跑）| `clearSourceHighlight` body 顶部加 `return`（no-op） | sourceHighlight 3 个 clear 相关用例（清扫 / A→B / 循环） | sourceHighlight 3 ✓ —— **但 MainTextBlock 的 `removes all injected spans when the component unmounts (effect cleanup)` 仍 GREEN** | **新假绿被抓到** |

**新假绿根因**：testing-library 的 `unmount()` 会把 React 子树连同包裹 span 的 wrapper `<div>` 一起从 DOM 拆掉。所以 unmount 后 `querySelectorAll('span.branch-anchor-highlight')` 返回 0，不是因为 `clearSourceHighlight` 真的清了，而是因为容器 DOM 没了。test name 暗示 "effect cleanup"，断言却被 "subtree 拆除" 这个旁路条件满足 —— 形状跟原 `data-branch-anchored` 假绿一模一样。

**修法**：1-for-1 替换为 `removes all spans when anchor context flips to non-matching (deps-change cleanup)`。用 testing-library 的 `rerender` 把 BranchAnchorContext 的 value 从 `{ highlightedBlockId: 'blk-A', start: 0, end: 8 }` 翻成 `{ highlightedBlockId: null, ... }` —— 组件**保持 mounted**，effect deps 变了 → React 跑前一次 effect 的 cleanup → cleanup 函数体里调 `clearSourceHighlight()`。如果 clearSourceHighlight 是 no-op，spans 没人清、组件还在、第二个 `toHaveLength(0)` 断言失败 → RED。Mutation 2 重跑验证：该用例**立即 RED** ✓。

**禁忌（future-you）**：测 effect cleanup 路径**不要用 `unmount()`**。任何让 React 自己拆容器的捷径（unmount / 切到不同 key / 移到不同 parent）都会从 "测 cleanup" 退化为 "测 subtree 没了"。让组件保持 mounted、只翻 effect deps，cleanup 是唯一能让断言通过的执行路径。

---

## 不要做（future-you red flags）

- ❌ **不要重新尝试 CSS Custom Highlight API**。Trace 已证明在本 env 下注册成功但零渲染。如果未来 Chromium 修了，可以再试，但**先在隔离 demo 上验证**，不要直接换回来
- ❌ **不要用 `range.surroundContents`**。markdown 选区跨边界是常态、不是边界条件
- ❌ **不要把 `clearSourceHighlight` 改回 `while/insertBefore/removeChild` 两步**。`replaceWith` 是 atomic、不会留 shell
- ❌ **不要从 `BranchAnchorContext.tsx` 里删掉 globalThis singleton wrap**。删了之后 dev HMR 编辑这个文件就会导致 Provider/consumer context 对象分裂、`insideProvider:false`、高亮失效（D-013-FIX 现象的真实根因之一）
- ❌ **不要把 `clearSourceHighlight()` 从 Chat.tsx `onComposeCancel` 里删掉**。MainTextBlock effect cleanup 也会调 clear（兜底），但显式 sync 调用保证 DOM 在 panel collapse 动画前已干净、无视觉闪烁

---

## 未做（v1.1+）

- **anchor 持久化**：切 topic 回来高亮恢复 / 重启 app 高亮恢复
- **多个并存高亮**：当前只支持 1 个 anchor / 1 个分支；多分支同开时要扩展为 `Map<branchTopicId, BranchAnchor>` + 多色或编号
- **点击 span 重开 panel**（旧 README §3）—— 当前 span 无 `data-anchor-id`，且未挂事件委托。要做需配合持久化（否则点了也找不到对应 branchTopic）
- **键盘可达性**：tab 到高亮文字、screen reader 读出 "branch source passage"

——

最后更新：2026-05-31
负责人：Sammier + Claude（Opus 4.7 1M）
