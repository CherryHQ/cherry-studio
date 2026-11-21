---
description: 如何配置 Webz.io 新闻搜索？
icon: newspaper
---

# Webz.io 新闻搜索配置

[Webz.io](https://webz.io/) 的新闻搜索 API 用自然语言检索**最近 30 天**的全球新闻，按语义相关度排序，并返回与问题最相关的文章段落。在 Cherry Studio 中它作为 **Webz.io News** 搜索服务商提供，只有关键词搜索能力，不提供 URL 获取。

## 一、获取 API 密钥

1. 打开 [https://app.webz.io](https://app.webz.io)，用邮箱验证码（或 Google / Microsoft 账号）注册并登录。
2. 在控制台中创建或复制 News Search API 的密钥。

## 二、在 Cherry Studio 中配置

1. 进入 **设置 → 网络搜索**。
2. 搜索服务商选择 **Webz.io News**。
3. 填入上一步获取的 API 密钥，保存即可。

Cherry Studio 会向 Webz.io 发送一次 `POST https://api.webz.io/api/news/context` 请求（HTTPS，密钥经加密传输），仅携带查询文本和结果数量两个参数，单次最多返回 50 条。

## 三、注意事项

* **仅覆盖最近 30 天的新闻**，更早的新闻搜不到属于正常现象。
* 每次搜索都会消耗 Webz.io 账户的配额（credits），结果数量设置得越大消耗越多。
* 该服务商只提供新闻搜索，不支持按国家、语言、日期等条件过滤。

更多细节见官方文档：[Webz.io News Search API](https://docs.webz.io/docs/webz/news-search-api)。
