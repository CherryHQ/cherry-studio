# Agent Note: 设置搜索的 Unicode 等价匹配

Status: implemented

[English](2026-11-18-settings-search-unicode.md) | 中文

## 问题

设置搜索原先使用小写转换和 NFC。等价输入可能搜不到设置，例如德语 ss 与 ß、希腊字母 sigma 的变体、东亚全半角，以及用无重音词搜索带重音标签。韩语词库也缺少搜索回归验证。

## 决策

采用 [W3C String Searching](https://www.w3.org/TR/string-search/) 第 2.2.2–2.2.6、2.2.9 和 2.2.10 节中适用的默认匹配建议。这是 Group Note Draft，并非完整的合规标准。通过 unicode-case-folding 实现默认完整大小写折叠，仅对全半角区段应用 NFKC，再用 NFC 合成规范等价字符。忽略统一表意文字后的补充表意文字变体选择符。仅当规范化后的查询不含组合变音标记时，移除候选文本中的组合变音标记。保留现有的忽略空白回退、排序、拼音匹配和英文源文本查询。

## 考虑过的替代方案

- 小写转换遗漏完整大小写折叠的展开；手写映射会重复维护 Unicode 数据。
- 对整串应用 NFKC 也会合并带圈数字等无关兼容形式。
- 无条件移除重音会丢失用户明确输入的区别；删除所有组合标记还会抹去文字中有意义的组成部分。

## 后果

显示标签保持原样。韩语预组合音节和分解音节可以互相匹配，不会混淆不同音节。渲染进程增加一个小型打包依赖。设置搜索仍是宽容的子串查询，不增加敏感度开关、语言特定大小写规则、数字转写、拼写同义词、整词匹配或韩语首辅音匹配。这些是独立产品选择，并非声称完整实现草案。

## 验证

- Regression — searchEngine.test.ts 覆盖完整折叠、全半角、韩语规范等价、空白、非对称重音、表意文字变体以及不应匹配的区别。
- Regression — settingsSearchIndex.test.ts 使用真实词库查找韩语语言、代理和启动设置，包含英文 proxy 查询。
- Regression — searchEngine.test.ts、settingsSearchIndex.test.ts 和 SettingsSearchBox.test.tsx 共 98 项测试通过。
