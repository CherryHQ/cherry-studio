# Agent Note: 让模型选择器中被截断的模型名称可见

Status: implemented

[English](2026-11-11-model-selector-name-overflow.md) | 中文

## 问题

`ModelSelector` 的行把模型名称截成单行 `truncate`，并让它与 `| <模型 ID>` 消歧后缀争夺同一段空间。后缀使用 `flex-[1_999_0%]`，一旦名称占满整行就收缩到零宽并被 `overflow-hidden` 丢弃；名称则保留自身所需宽度并被截断。因此较长的上游名称无法读全——CherryIN 提供的 `Deepseek: DeepSeek: DeepSeek V4.1 Flash (1017)` 中，厂牌前缀被其自身 API 重复了一次，最终显示为 `Deepseek: DeepSeek: DeepSeek V4.1 Fla...`。

唯一的兜底是原生 `title` 属性：出现慢（约一秒）、无法定制样式、不会换行；而本该显示完整名称的详情卡标题同样是 `truncate`，于是它也一起被截断。

## 决策

把行内名称的原生 `title` 换成 `@cherrystudio/ui` 的 `Tooltip`，并且仅在名称确实溢出时挂载。溢出判定为 `scrollWidth > clientWidth + 1`，通过 ref 加 `ResizeObserver` 测量，因此名称能完整显示的行行为不变：不出 tooltip，也没有多余的可悬停区域。

详情卡标题取消 `truncate`，改为 `break-words`，在原有带高度上限、可滚动的容器内换行显示完整名称。

消歧后缀维持现有 flex 行为。重新分配名称与后缀的宽度属于另一项展示决策，本次修复只保证完整文本可达。

## 考虑过的替代方案

- 保留原生 `title`：不换行、不可定制、需要约一秒，而本次问题正是被截断的文本读不到。
- 始终挂载 tooltip：对已经完整可见的文本重复一遍内容，并给每一行都增加无意义的悬停区域。
- 压缩名称、让后缀保留一份宽度：两段都会截断，行内反而比现在少显示字符。
- 去掉上游名称里重复的厂牌前缀：这是对提供商提供名称的展示策略，而非截断缺陷，需要为每个提供商单独定规则。

## 影响

名称溢出的行在悬停 300 毫秒后，通过宽度受限、可换行的 tooltip 显示完整名称；名称未溢出的行保持原有行为。详情卡标题最多占三行而不是一行，卡片因此变高而不再隐藏文本。名称、模型解析与选择行为均未改变。

## 验证

- Regression — `ModelSelector.test.tsx` 渲染一个名称宽度超过整行的行，断言该行通过 tooltip 暴露完整名称：该用例在改用 tooltip 之前的原生 `title` 实现上失败，修复后通过。该文件其余用例与 `ModelSelectorDetailCard.test.tsx` 保持行渲染、选择、置顶与详情卡内容通过。
- Regression — 在 CherryIN 名称长度超过行宽的 dev 档案中运行 Electron：溢出行的测量值为 `scrollWidth 497 > clientWidth 281`，悬停后打开宽 320 px、状态为 `delayed-open` 的 tooltip 并换行显示完整名称；名称可容纳的行测量值为 `scrollWidth === clientWidth`，不打开 tooltip。
- Regression — 同一次 Electron 运行中，详情卡标题为 60 px 的三行文本且 `scrollWidth === clientWidth`，卡片不再截断名称。
