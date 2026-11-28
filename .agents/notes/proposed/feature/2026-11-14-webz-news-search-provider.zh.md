# Agent Note: Webz.io News Search 网络搜索提供方

Status: proposed

[English](2026-11-14-webz-news-search-provider.md) | 中文

## Problem

Cherry Studio 的网络搜索提供方都是通用网页索引。时事研究、媒体监测和基于新闻的回答需要带发布日期和来源元数据的近期新闻文章。Issue CherryHQ/cherry-studio#20821 请求增加 Webz.io News Search 提供方。Webz.io 文档中的 News Search API 返回最近 30 天的文章，按语义匹配排序，并附带相关摘录。

## Proposal

新增 `webz` 远程网络搜索提供方，名称为 "Webz.io News"，仅提供 `searchKeywords` 能力。它沿用 Tavily 的模式：API key 保存在网络搜索设置中，在 `packages/web-search/src/providers/` 中实现 `WebSearchProviderModule`，并注册到共享目录和提供方 ID 列表。

每次搜索向文档中的端点 `http://api.webz.io/api/news/context` 发送 JSON `POST`，请求头为 `Authorization: Bearer <apiKey>`。请求体中 `query` 为用户输入，`k` 为请求的结果数量，上限为 50。不发送其他请求参数：不包含过滤器、`score_gte` 或 `allow_multiple_chunks_per_article`。返回的每篇文章映射为标准搜索结果：`article.title` 映射到 `title`，`article.url` 映射到 `url`，`chunk.text` 映射到 `content`，输入映射到 `sourceInput`。没有 URL 的条目会被丢弃。提供方只返回 API 所给内容，不会向 `WebSearchResult` 添加日期或来源字段。

结果数量上限采取保守值。[参数参考](https://docs.webz.io/docs/webz/news-search-api-parameters)（2026 年 8 月 30 日更新）记录的 `k` 上限为 100，而[错误参考](https://docs.webz.io/docs/webz/news-search-api-errors-limits)（2026 年 8 月 19 日更新）表示 `k > 50` 会返回 HTTP 422。两页均于 2026 年 11 月 14 日核对；未通过带认证的请求验证是否支持 51-100 条结果。因此，本 Spec 将 `k` 上限设为两个文档值中较低的 50。提高上限前必须先解决这一上游契约冲突。

该端点文档标注为明文 HTTP。实现时必须确认同一端点是否支持 HTTPS，再决定默认 host。如果只能使用 HTTP，提供方将以此默认值发布，Bearer token 会以未加密方式传输；只有在本 Spec 获得明确批准后才接受这一后果。

超出范围：过滤器（国家、语言、类别、情感、日期）、相关性阈值、通过 News API 获取全文，以及任何 fetch-URL 能力。

## Alternatives considered

- 已有通用搜索提供方，但它们不返回新闻专用元数据，也不保证近期新闻覆盖。
- 现在暴露过滤器会增加配置面和设置界面，而请求方并未要求；以后可以通过单独的 Spec 添加。
- 自定义 MCP 服务器可行，但用户需要在 Cherry Studio 之外配置，无法使用与 Tavily、Exa 相同的提供方选择流程。
- 通过 News API 增加全文获取，会使每次搜索的积分消耗翻倍，并引入第二套上游契约。

## Acceptance criteria

- AC1 — `webz` 提供方 ID、元数据和 `searchKeywords` 能力已注册到共享目录与提供方列表，网络搜索设置提供带 API key 输入的入口（verification: unit）
- AC2 — 关键词搜索发送一次带认证的 POST，包含 `query` 与 `k`，并将返回文章映射为标题、URL、摘录和来源输入，丢弃没有 URL 的条目（verification: unit）
- AC3 — 请求结果数超过 50 时上限为 50；非成功响应或异常响应体会作为提供方错误抛出（verification: unit）
- AC4 — 渲染层存在提供方图标、显示名称与本地化标签，生成的消费者保持一致（verification: renderer）
- AC5 — 提供方文档（包括 HTTP 端点和 30 天覆盖窗口）已更新为英文与中文（verification: docs gate）

## Risks

文档中的端点是明文 HTTP，除非确认支持 HTTPS，否则 Bearer token 可能在传输中暴露。30 天覆盖窗口意味着查询较早的新闻会返回空结果，提供方无法检测这一点，也不应伪造结果。每次搜索都会消耗积分，因此结果数默认值应保守。Webz.io 文档可能变化；实现时必须重新核对端点和响应字段。
