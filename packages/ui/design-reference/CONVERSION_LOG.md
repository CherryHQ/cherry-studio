# todocss.css → design-tokens.css 转换日志

## ✅ 已转换的变量

### 基础颜色 (Primitive Colors)
- ✅ Neutral (50-950)
- ✅ Zinc (50-950)
- ✅ Red (50-950)
- ✅ Orange (50-950)
- ✅ Amber (50-950)
- ✅ Yellow (50-950)
- ✅ Lime (50-950) - 品牌主色
- ✅ Green (50-950)
- ✅ Emerald (50-950)
- ✅ Purple (50-950)
- ✅ Blue (50-950)
- ✅ Black & White

### 语义化颜色 (Semantic Colors)
- ✅ `--cs-primary` (Lime 500)
- ✅ `--cs-destructive` (Red 500)
- ✅ `--cs-success` (Green 500)
- ✅ `--cs-warning` (Amber 500)
- ✅ `--cs-background` (Zinc 50/900)
- ✅ `--cs-foreground` 系列 (main, secondary, muted)
- ✅ `--cs-border` 系列 (default, hover, active)
- ✅ `--cs-ring` (Focus)

### 容器颜色
- ✅ `--cs-card` (White/Black)
- ✅ `--cs-popover` (White/Black)
- ✅ `--cs-sidebar` (White/Black)

### UI 元素细分颜色 (新增补充)
- ✅ **Modal / Overlay**
  - `--cs-modal-backdrop`
  - `--cs-modal-thumb`
  - `--cs-modal-thumb-hover`

- ✅ **Icon**
  - `--cs-icon-default`
  - `--cs-icon-hover`

- ✅ **Input / Select**
  - `--cs-input-background`
  - `--cs-input-border`
  - `--cs-input-border-hover`
  - `--cs-input-border-focus`

- ✅ **Primary Button**
  - `--cs-primary-button-background`
  - `--cs-primary-button-text`
  - `--cs-primary-button-background-hover`
  - `--cs-primary-button-background-active`
  - `--cs-primary-button-background-2nd`
  - `--cs-primary-button-background-3rd`

- ✅ **Secondary Button**
  - `--cs-secondary-button-background`
  - `--cs-secondary-button-text`
  - `--cs-secondary-button-background-hover`
  - `--cs-secondary-button-background-active`
  - `--cs-secondary-button-border`

- ✅ **Ghost Button**
  - `--cs-ghost-button-background`
  - `--cs-ghost-button-text`
  - `--cs-ghost-button-background-hover`
  - `--cs-ghost-button-background-active`

### 尺寸系统
- ✅ Spacing/Sizing 合并为 `--cs-size-*` (5xs ~ 8xl)
- ✅ Border Radius (4xs ~ 3xl, round)
- ✅ Border Width (sm, md, lg)

### 字体排版
- ✅ Font Families (Heading, Body)
- ✅ Font Weights (修正单位错误: 400px → 400)
- ✅ Font Sizes (Body & Heading)
- ✅ Line Heights (Body & Heading)
- ✅ Paragraph Spacing

---

## ❌ 已废弃的变量

### Opacity 变量 (全部废弃)
使用 Tailwind 的 `/modifier` 语法替代：

| todocss.css | 替代方案 |
|-------------|---------|
| `--Opacity--Red--Red-80` | `bg-cs-destructive/80` |
| `--Opacity--Green--Green-60` | `bg-cs-success/60` |
| `--Opacity--White--White-10` | `bg-white/10` |

**原因**: Tailwind v4 原生支持透明度修饰符，无需单独定义变量。

---

## 🔧 关键修正

### 1. 单位错误
```css
/* ❌ todocss.css */
--Font_weight--Regular: 400px;

/* ✅ design-tokens.css */
--cs-font-weight-regular: 400;
```

### 2. px → rem 转换
```css
/* ❌ todocss.css */
--Spacing--md: 40px;

/* ✅ design-tokens.css */
--cs-size-md: 2.5rem;  /* 40px / 16 = 2.5rem */
```

### 3. 变量合并
```css
/* ❌ todocss.css (冗余) */
--Spacing--md: 40px;
--Sizing--md: 40px;

/* ✅ design-tokens.css (合并) */
--cs-size-md: 2.5rem;
```

### 4. Dark Mode 分离
```css
/* ❌ todocss.css (Light 和 Dark 都在 :root) */
:root {
  --Brand--Semantic_Colors--Background: var(--Primitive--Zinc--50);
  --Brand--Semantic_Colors--Background: var(--Primitive--Zinc--900); /* 后面覆盖 */
}

/* ✅ design-tokens.css (正确分离) */
:root {
  --cs-background: var(--cs-zinc-50);
}

.dark {
  --cs-background: var(--cs-zinc-900);
}
```

---

## 📊 变量统计

| 分类 | todocss.css | design-tokens.css | 说明 |
|------|-------------|-------------------|------|
| Primitive Colors | ~250 | ~250 | 完整保留 |
| Semantic Colors | ~20 | ~20 | 完整转换 |
| UI Element Colors | ~30 | ~30 | ✅ 已补充完整 |
| Opacity Variables | ~50 | 0 | 废弃，用 `/modifier` |
| Spacing/Sizing | 32 | 16 | 合并去重 |
| Typography | ~50 | ~50 | 修正单位 |
| **总计** | ~430 | ~390 | 优化 40 个变量 |

---

## 🎨 Dark Mode 变量对比

| Light Mode | Dark Mode | 变量名 |
|-----------|-----------|-------|
| Zinc 50 | Zinc 900 | `--cs-background` |
| Black 90% | White 90% | `--cs-foreground` |
| Black 60% | White 60% | `--cs-foreground-secondary` |
| Black 10% | White 10% | `--cs-border` |
| White | Black | `--cs-card` |
| White | Black | `--cs-popover` |
| White | Black | `--cs-sidebar` |
| White | Black | `--cs-input-background` |
| Black 40% | Black 6% | `--cs-modal-backdrop` |
| Black 20% | White 20% | `--cs-modal-thumb` |
| Black 5% | White 10% | `--cs-secondary` |
| Black 0% | White 0% | `--cs-ghost-button-background` |

---

## ✅ 验证清单

- [x] 所有 Primitive 颜色已转换
- [x] 所有语义化颜色已转换
- [x] 所有 UI 元素颜色已转换
- [x] Dark Mode 变量完整
- [x] 尺寸单位统一为 rem
- [x] Font Weight 单位已修正
- [x] Opacity 变量已废弃
- [x] Spacing/Sizing 已合并

---

## 📝 使用指南

### 如果设计师更新 todocss.css

1. 对比此文档，找出新增/修改的变量
2. 按照转换规则更新 `design-tokens.css`
3. 验证 Light/Dark Mode 是否完整
4. 更新此日志

### 验证转换正确性

```bash
# 检查 Light Mode 变量数量
grep -c "^  --cs-" packages/ui/src/styles/design-tokens.css

# 检查 Dark Mode 覆盖数量
grep -c "^  --cs-" packages/ui/src/styles/design-tokens.css | grep -A 100 ".dark"
```

