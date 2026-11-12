# Agent Note: 网络搜索黑名单订阅

Status: proposed

[English](2026-11-12-web-search-blacklist-subscriptions.md) | 中文

## Problem

v1 允许用户为网络搜索黑名单添加 uBlacklist 格式的订阅 URL。v2.0.2 只保留手动输入的 `chat.web_search.exclude_domains` 文本框，社区名单（如 `eallion/uBlacklist-subscription-compilation`）无法再使用。官方文档仍描述订阅功能。v1 的订阅条目（`websearch.subscribeSources`，`{ key, url, name, blacklist? }`）未迁移到 v2；v1 迁移路径还会把该字段重置为 `[]`，因此旧数据可恢复的内容可能很少或没有。

## Proposal

将订阅源恢复为现有黑名单的额外输入。手动规则保持不变。

- 存储：新增偏好 `chat.web_search.blacklist_subscriptions`，为 `{ id, url, name?, rules: string[], updatedAt?, lastError? }` 组成的 JSON 数组。不使用 SQLite 表。缓存的 `rules` 与订阅源一起保存，使搜索在离线时仍可工作。
- 解析：订阅内容采用 uBlacklist 格式。逐行去除首尾空白，跳过空行和注释（`#`、`!`），仅保留 `parseMatchPattern` 或正则解析器接受的行。无效行计数后丢弃，不导致整个列表失败。
- 生效黑名单：`WebSearchService` 在调用 `filterWebSearchResponseWithBlacklist` 和 `toExcludedSiteDomains` 之前，将手动 `exclude_domains` 与所有已启用订阅的规则合并（去重）。刷新订阅不会移除手动规则。
- 刷新：设置页提供每个订阅源的手动刷新按钮；主进程通过 `registerInterval` 每 24 小时定期刷新。刷新失败时保留上一次成功的规则，并记录 `lastError`。
- 渲染层：带校验的添加 URL 输入框；订阅列表显示名称、规则数、最近更新时间和错误状态，并提供刷新与移除操作。使用 `@cherrystudio/ui` 构建。
- v1 迁移：专用迁移器在存在时读取 `websearch.subscribeSources`，并写入同一偏好。v1 中缺失的字段留空；迁移器不猜测 URL。
- 范围外：本地文件导入、uBlacklist 以外的订阅格式、跨设备同步。

## Alternatives considered

- 通过 DataApi 使用 SQLite 表：可提供关系化历史和更清晰的刷新跟踪，但数据是少量 URL 与缓存规则，随设置一起加载。为此新增 schema、迁移和 DataApi 端点收益很小。
- 仅手动刷新：更简单，且无后台网络活动，但用户不手动刷新时订阅会过期。用户选择了定期刷新，因此未采用。
- 仅在应用启动时刷新：避免定时器，但长时间运行的会话永远不会更新。未采用。
- 本地文件批量导入：对离线名单有用，但不能恢复 v1 的 URL 功能。暂缓；用户已在本次变更中拒绝。
- 将每条订阅规则都转换为供应商 `Site` 排除：只有整域规则符合条件（见现有 `toExcludedSiteDomains` 约定）。其他规则仍在本地生效，与现在一致。

## Acceptance criteria

- AC1 — 添加有效的 HTTP(S) 订阅 URL 后会保存、抓取，并显示解析出的规则数（验证：renderer）
- AC2 — 无效或非 HTTP(S) 的 URL 在 UI 中被拒绝，且从不保存（验证：renderer）
- AC3 — uBlacklist 解析忽略空行和 `#`/`!` 注释，保留有效的匹配模式与正则，丢弃无效行且不导致整个列表失败（验证：unit）
- AC4 — 仅命中订阅规则的搜索结果会被移除；移除订阅后，手动规则仍然生效（验证：unit）
- AC5 — 每 24 小时的定期刷新与手动刷新会更新缓存规则；刷新失败时保留旧规则并设置 `lastError`（验证：unit）
- AC6 — 移除订阅会从生效黑名单中删除其规则，且不改变手动 `exclude_domains`（验证：unit）
- AC7 — 带 URL 的 v1 `websearch.subscribeSources` 条目迁移到新偏好；没有 URL 的条目被跳过（验证：unit）
- AC8 — 整域订阅规则通过 `toExcludedSiteDomains` 进入供应商 `Site` 排除，手动规则的行为保持不变（验证：unit）
- AC9 — 没有订阅时，手动黑名单行为保持不变（验证：unit、renderer）
- AC10 — 所有新增的用户可见字符串都存在于 `en-us.json`，并通过 `pnpm i18n:sync` 同步到所有语言，且不残留占位符（验证：docs gate）

## Risks

- 定期抓取会增加对外网络流量；必须遵循应用的代理设置，并使用有上限的超时。
- 体量很大或恶意的名单可能拖慢过滤；实现应限制每个源的规则数量。
- v1 数据可能因早期迁移而为空，因此 AC7 对许多用户可能迁移不到任何内容。文档必须说明需要重新添加订阅。
- 偏好 schema 由 `data/classification.json` 生成；变更必须经过 `scripts/data-classify`，不得手动编辑生成文件。
