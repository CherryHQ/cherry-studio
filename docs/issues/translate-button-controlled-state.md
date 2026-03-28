# TranslateButton 受控/非受控状态混合问题

## 问题描述

`src/renderer/src/components/TranslateButton.tsx` 同时维护内部 `isTranslating` state 和外部 `isLoading` prop，通过 `useEffect` 同步两者，属于 React 反模式（derived state from props）。

## 现状

组件内部通过 `handleTranslate` 管理 `isTranslating` 状态，同时接受外部 `isLoading` prop 并用 `useEffect` 覆盖内部状态：

```tsx
useEffect(() => {
  setIsTranslating(isLoading ?? false)
}, [isLoading])
```

## 调用方式分类

| 调用方 | 传入 isLoading | 传入 text | 翻译逻辑在哪 |
|--------|---------------|-----------|-------------|
| MessageEditor | 否 | 否 | 内部 |
| InputbarCore | 是 | 是 | 外部 |
| paintings 页面 (x5) | 是 | 是 | 内外都有 |

## 风险

- 外部 `isLoading` 和内部 `handleTranslate` 状态可能冲突
- paintings 页面同时传 `disabled` 和 `isLoading`，语义重复
- `useEffect` 同步 prop 到 state 容易导致状态不一致

## 建议方案

明确区分受控/非受控模式：

- **受控模式**（传入 `isLoading`）：去掉内部 state，由外部完全控制 loading 和点击行为
- **非受控模式**（不传 `isLoading`）：内部自管理翻译状态

不要用 `useEffect` 做 prop 到 state 的同步。

## 涉及文件

- `src/renderer/src/components/TranslateButton.tsx`
- `src/renderer/src/pages/home/Inputbar/components/InputbarCore.tsx`
- `src/renderer/src/pages/home/Messages/MessageEditor.tsx`
- `src/renderer/src/pages/paintings/TokenFluxPage.tsx`
- `src/renderer/src/pages/paintings/PpioPage.tsx`
- `src/renderer/src/pages/paintings/AihubmixPage.tsx`
- `src/renderer/src/pages/paintings/NewApiPage.tsx`
- `src/renderer/src/pages/paintings/SiliconPage.tsx`
