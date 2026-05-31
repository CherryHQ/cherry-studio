# P1-S2a — Highlight Implementation：data-branch-id + per-branch color + targeted clear

**状态**：✅ 已完成（2026-06-01；focused 40/40 绿；mutation M1+M2 全部 expected-red 命中、零 fake-green；待 commit）
**前置**：[[../P1-S1_StateFoundation/README|P1-S1 State Foundation]]（branches[] 数组化已入库 commit `f915938ec`）
**前一篇**：[[../README|P1 概览]]

---

## 目标

把 paint/clear 实现从"全局，单分支假定"升级成"按 branchId 定位、多分支可并存"：
- 每个注入的 span 都 stamp `data-branch-id="{branchId}"` 和 `data-hl="{colorKey}"`
- `clearSourceHighlight(branchId)` 只擦该 id 的 span，**绝不**误伤其它分支
- `paintSourceHighlight(blockEl, start, end, branchId, colorKey)` 体内的"擦旧"也按 id 走，所以 paint(A) 不会动 B
- 加 6 色调色板（CSS variable + data-hl 属性 selector）

**UI 仍然 ≤ 1 分支**（没动 fork / model picker / 没加第二分支创建路径）。多分支能力的验证完全靠**测试构造的双 branchId DOM fixture** —— 实现先准备好，S2b 才上 UI。

## 为什么这一步重要

这是 `sourceHighlight.ts`（D-013 13 轮调试的同一文件）唯一一次允许动核心算法。如果 S2b 上 UI 之前不把"全擦"改成"按 id 擦"，那么任意时刻 paint(B) 都会把 A 的 span 擦掉 —— **silent regression**：用户感觉就是开第 2 个分支时第 1 个无缘无故消失。这是 spec 里点名的最高风险路径，所以本步带满 mutation 验证。

## 触碰边界（守住）

- **未动** `__BRANCH_ANCHOR_CTX_CACHE__` HMR 缓存模式（D-013-FIX 根因防御）
- **未动** fork / streaming / provider / model picker / Redux / Dexie
- **未加** 任何多分支 UI（卡片列表、collapse、hover linkage、第 2 分支创建）。`collapsedBranchIds` 仍然 unconsumed（S2b 才接）
- **UI 仍 ≤ 1 分支** —— 用户在 app 里跑出来跟之前没区别（同一颜色、单分支高亮、targeted 关闭）

## 改动逐项

### 1. Branch + Anchor 加 color 字段

| 文件 | 改动 |
|---|---|
| `src/renderer/src/pages/home/Messages/BranchPanel/constants.ts` | + `BRANCH_HL_COLOR_KEYS = ['c1','c2','c3','c4','c5','c6'] as const` + `type BranchHlColorKey` + `BRANCH_HL_DEFAULT_COLOR = 'c1'` |
| `src/renderer/src/pages/home/Messages/BranchPanel/types.ts` | `Branch` + `color: BranchHlColorKey` 字段 |
| `src/renderer/src/pages/home/Messages/BranchPanel/index.ts` | 多 export `BRANCH_HL_COLOR_KEYS / BRANCH_HL_DEFAULT_COLOR / BranchHlColorKey` |
| `src/renderer/src/context/BranchAnchorContext.tsx` | `BranchAnchorHighlight` + `color: BranchHlColorKey` 字段 |
| `src/renderer/src/pages/home/Chat.tsx` | `openBranchAnchor` 创建时写 `color: BRANCH_HL_DEFAULT_COLOR`；`branchAnchorHighlight` useMemo 派生 `color: b.color` |

### 2. `sourceHighlight.ts` — 新 API

```ts
// 旧：
export function paintSourceHighlight(blockEl: Element, start: number, end: number): void
export function clearSourceHighlight(): void

// 新：
export function paintSourceHighlight(
  blockEl: Element,
  start: number,
  end: number,
  branchId: string,
  colorKey: string
): void

export function clearSourceHighlight(branchId: string): void
```

**关键内部改动**：
- `wrapRangeWithSpans` 多接 `branchId, colorKey` 两个参数，对每个注入的 span 都 `setAttribute(BRANCH_ID_ATTR, branchId)` + `setAttribute(COLOR_KEY_ATTR, colorKey)`。包括跨节点选区的每一个 span。
- `clearSourceHighlight` 改用 attribute selector `span.${WRAP_CLASS}[data-branch-id="${escape(branchId)}"]`，只匹配 THIS branch 的 span。`CSS.escape` 防御 branchId 注入。
- `paintSourceHighlight` 体内首行 `clearSourceHighlight()` → `clearSourceHighlight(branchId)`。**这是 S2b 不爆炸的关键** —— paint(B) 不再隐式擦 A。
- `ensureHighlightStyle` 注入 6 个 `--branch-hl-c[1..6]` CSS 变量 + 6 条 `span[data-hl="cN"]` 规则。原来的单条 amber 规则保留为 fallback。CSS 用 concrete `rgb(... / 0.45)`（Tailwind *-400 系列 + 45% alpha），不依赖 DESIGN.md token（D-010 教训保留）。

### 3. MainTextBlock effect — targeted cleanup

```ts
const paintedBranchIds = matchingAnchors.map(a => a.branchId)
for (const a of matchingAnchors) {
  paintSourceHighlight(el, a.selectionStart, a.selectionEnd, a.branchId, a.color)
}
return () => {
  cancelAnimationFrame(raf)
  for (const id of paintedBranchIds) clearSourceHighlight(id)
}
```

闭包捕获本次 effect 真的画过的 branchIds，cleanup 时按 id 一一擦。**绝不全擦**。Effect deps 仍是 `[matchingAnchors, block.content]`（来自 P1-S1）。

### 4. Chat.tsx close path — targeted clear

```ts
onComposeCancel={() => {
  branches.forEach((b) => clearSourceHighlight(b.id))  // 旧：clearSourceHighlight()
  setBranches([])
  setCollapsedBranchIds(new Set())
  branchFork.reset()
}}
```

≤ 1 分支时这是单次 clear；S2b 多分支时按 id 一个个擦。一切跟"全擦"绝缘。

### 5. CSS（注入在 `ensureHighlightStyle` 的 `<style id="branch-anchor-highlight-style">` 里）

```css
:root {
  --branch-hl-c1: rgb(251 191 36 / 0.45);  /* amber-400 — legacy default */
  --branch-hl-c2: rgb(56 189 248 / 0.45);  /* sky-400 */
  --branch-hl-c3: rgb(167 139 250 / 0.45); /* violet-400 */
  --branch-hl-c4: rgb(244 114 182 / 0.45); /* pink-400 */
  --branch-hl-c5: rgb(74 222 128 / 0.45);  /* green-400 */
  --branch-hl-c6: rgb(251 146 60 / 0.45);  /* orange-400 */
}
span.branch-anchor-highlight { background-color: var(--branch-hl-c1); }
span.branch-anchor-highlight[data-hl="c1"] { background-color: var(--branch-hl-c1); }
...
span.branch-anchor-highlight[data-hl="c6"] { background-color: var(--branch-hl-c6); }
```

CSS 自包含（注入在 head），不依赖 DESIGN.md 加载顺序。

## 测试

### 文件 1：`sourceHighlight.test.ts` — 19 用例

**未动**：9 个 `captureSelectionOffsets ↔ resolveBranchHighlightRange round-trip` —— 跟 paint/clear 无关，shape 不变。

**改写**（6 个 paint/clear 单分支用例）—— 全部加了 `branchId` + `colorKey` 参数 + **data-branch-id / data-hl 属性断言**：
- `paint single-text-node` → 新增 `expect(spans[0].getAttribute('data-branch-id')).toBe(A)` + `data-hl="c1"`
- `paint multi-node` → 对**每一个**注入的 span 都断言 attribute（跨节点不漏）
- `clear(branchId)` → 用 helper `queryByBranch(root, id)` 校验
- `clear(branchId) idempotent` → `clearSourceHighlight('never-painted')` 不抛
- `re-painting same branchId replaces` → 语义从"两个不同 selection 后只剩一个"改成"重复同一个 id，paint 内部 clear-by-id 让旧 span 消失、新 span 唯一存在"
- `repeated paint/clear cycles for one branchId` → 同 id 反复，不累积，DOM 字节级复原

**新增**（4 个 multi-branch 用例，spec Step 5a 提的 5 个场景，我把 "clear(A) leaves B" 和 "clear(B) wipes" 合成一个 then-chain 用例提高可读性）：

| 用例 | 守护的真实行为 |
|---|---|
| `disjoint paint(A) + paint(B) coexist` | paint(B) 不擦 A；两个 branch 的 span 集 + 文本 + 颜色都独立 |
| `clear(A) leaves B fully intact; then clear(B) wipes` | 关闭一个分支不动另一个：count + text + data-hl 全部不变；都关闭后 DOM 字节级复原 |
| `nested/overlapping: clear(A) leaves nested B intact` | 选区重叠时 B 的 span 嵌套进 A 的 span；clear(A) unwrap A 后 B 的嵌套 span 还在，文本拼接 + data-hl 不变 |
| `repeated paint/clear cycles across two branches` | 4 轮 paint(A)+paint(B)+clear(A)+clear(B)，每一步 isolation 都正确，最终 DOM 字节级复原 |

### 文件 2：`MainTextBlock.test.tsx` — 21 用例（**未增减**）

- `highlight()` helper 加 `branchId` + `color` 默认参数（保旧调用签名不破）
- `injects span when matched` 用例**加 stamp 断言**：每个注入的 span 都断言 `data-branch-id === TEST_BRANCH_ID` + `data-hl === TEST_COLOR`
- `deps-change cleanup` 用例**未改一字** —— 它的语义本来就是 "anchors flip to [] → effect cleanup → spans 0"。现在 effect cleanup 走 targeted `clear(id)`，但因为只有一个 anchor、一个 id，断言 `document.querySelectorAll(...) === 0` 仍然正确，且仍然 non-vacuous（被 M2 抓到了）。

### 总数

- sourceHighlight.test.ts：15 → **19**（+4 个 multi-branch；spec 列了 5 个场景，合并一个 then-chain 后是 4 个 test）
- MainTextBlock.test.tsx：21 → **21**（用例数不动；加了 attribute 断言进现有用例）
- focused 总数：36 → **40**

## Mutation 验证（spec Step 6，本步必跑因动 sourceHighlight.ts）

### M1 — break targeting

```ts
// 改 clearSourceHighlight:
void branchId  // 忽略 branchId
const selector = `span.${WRAP_CLASS}`  // 选所有
```

**结果：4 RED / 36 GREEN**

RED（全是 multi-branch isolation 用例 — 完全符合预期）：
1. ✓ `disjoint paint(A) + paint(B) coexist` —— paint(B) 内部 clear-all 把 A 擦了
2. ✓ `clear(A) leaves B intact; then clear(B) wipes` —— clear(A) 擦了 B
3. ✓ `nested clear(A) leaves B` —— clear(A) 擦了 B
4. ✓ `repeated cycles across two branches` —— clear(A) 擦了 B

GREEN（单分支 + round-trip + MainTextBlock 全部）：因为 length=1 时 clear-all == clear-the-one。**这正是 spec 警告的 silent regression**：在 ≤1 分支的 UI 下永远看不见，但 S2b 一上 UI 就爆。

### M2 — break stamping

```ts
// 改 wrapRangeWithSpans:
void branchId  // 不 stamp data-branch-id
// span.setAttribute(COLOR_KEY_ATTR, colorKey)  保留 — 只破 id
```

**结果：11 RED / 29 GREEN**

RED（所有依赖 data-branch-id 的断言或 clear-by-id 路径都 fail）：
1. `paint single-text-node ... data-branch-id + data-hl` —— attr 断言 fail
2. `paint multi-node ... every span tagged` —— 同上
3. `clear(branchId) removes that branch spans` —— clear-by-id 找不到无 id 的 span
4. `re-painting same branchId replaces` —— paint 内部 clear-by-id no-op，span 累积成 2 个
5. `repeated paint/clear cycles for one branchId` —— 同上
6. `disjoint paint(A) + paint(B) coexist` —— query by id 返回 0（虽然 DOM 里有 span）
7. `clear(A) leaves B intact; then clear(B) wipes` —— clear no-op
8. `nested clear(A) leaves B` —— 同上
9. `repeated cycles across two branches` —— 同上
10. MainTextBlock `injects span ... data-branch-id + data-hl` —— attr 断言 fail
11. MainTextBlock `deps-change cleanup` —— cleanup clear-by-id no-op，span 不消失，第二个 `length === 0` 断言 fail

GREEN（独立于 data-branch-id 的）：
- 9 round-trip ✓
- `clear(branchId) idempotent when nothing to clear` ✓
- MainTextBlock 全部非高亮用例 ✓
- MainTextBlock `no Provider → no spans`, `different block → no spans`, `multi-block only matched has spans`（这些 paint 没被触发）✓

**没有 fake-green**。M2 同时把 MainTextBlock 的 deps-change cleanup 用例打红 —— 这是 spec 预期的级联，因为 cleanup 走 clear-by-id，stamping 一坏就没用了。

### Revert + 复绿

两轮 mutation 都用 `Edit` 单行替换、单行还原，无残留。最终 grep 全文件确认无 `M1 mutation` / `M2 mutation` / `void branchId` 字符串。focused 40/40 全绿。

## 不要做（future-you red flags）

- ❌ **不要把 `clearSourceHighlight(branchId)` 改回 `clearSourceHighlight()` 无参全擦**。silent regression：单分支看不见，S2b 多分支一上 UI 就互擦
- ❌ **不要在 `paintSourceHighlight` 体内首行调 `clearSourceHighlight()` 不传 id**（同理）
- ❌ **不要去掉 `wrapRangeWithSpans` 里的 `setAttribute(BRANCH_ID_ATTR, ...)`**（load-bearing —— targeted clear 靠它定位）
- ❌ **不要去掉 `setAttribute(COLOR_KEY_ATTR, ...)`**（CSS 颜色靠它）
- ❌ **不要把 attribute selector 里的 branchId 直接插字符串而不 `CSS.escape`**（防御性 —— 未来 id generator 一换可能爆）
- ❌ **不要去掉 `escapeAttrValue`**（同理）
- ❌ **不要把 `Chat.tsx` close path 的 `branches.forEach(b => clearSourceHighlight(b.id))` 改回单次 `clearSourceHighlight()`**

## S2a ↔ S2b 边界

**S2a 已做（这一步）**：实现 `paint(branchId, color)` + `clear(branchId)` + 6 色调色板 + 测试覆盖到多分支 fixture。UI 仍单分支。

**S2b 要做（下一步）**：
- 解 `branches.length ≤ 1` invariant —— 第 2 次右键 SelectionContextMenu 触发时不再 replace，改 append
- BranchPane 改成多分支视图（卡片列表 / tab / 类似），每张卡 hover 联动主对话上对应 span 的高亮
- `collapsedBranchIds` 接 UI（已 reserved，S2b 才消费）
- color 分配从固定 c1 改成 cycling（按 `branches.length % BRANCH_HL_COLOR_KEYS.length` 拿下一个）
- 关闭单个分支的 UI（X 按钮在每张卡上，调用 `clearSourceHighlight(b.id)` + 从 branches array 移除该项）
- S2b **不再需要动 sourceHighlight.ts** —— 该模块在 S2a 已就绪
