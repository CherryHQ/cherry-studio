---
icon: ban
---

# 网络搜索黑名单配置

不想让某些网站出现在联网搜索的结果里？在 `设置 → 网络搜索` 的 **黑名单** 里逐条添加要屏蔽的网站即可。规则写法参考 [ublacklist](https://github.com/iorate/ublacklist)。

## 手动配置

在黑名单输入框里 **按行** 添加规则，支持两种写法：

* **匹配模式**（[match pattern](https://developer.mozilla.org/zh-CN/docs/mozilla/add-ons/webextensions/match_patterns)）：如 `*://*.example.com/*`
* **正则表达式**：如 `/example\.(net|org)/`

添加后，命中规则的网站就不会再出现在联网搜索的结果里。

***

### 获取帮助与提交反馈

如果您在配置或使用过程中遇到任何疑问、Bug 或有功能改进建议，请参考 [反馈与建议](../../question-contact/suggestions.md) 中提供的官方渠道。
