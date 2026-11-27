# Agent Note: 保留 Querit 页面失败并限定抓取探测页面

Status: implemented

[English](2026-10-27-querit-fetch-probe.md) | 中文

## Problem

Querit `/v1/contents` 请求可以成功，但其中单个 URL 的抓取仍可能失败。Cherry 丢弃了文档规定的 `statuses[]` 结果，将明确的页面失败报告为 `invalid_response/empty_content`。通用 IPC 归一化（`IpcError.from` → `INTERNAL`）随后又在设置提示显示前丢失了提供商错误分类。设置检测还对所有远程抓取提供商使用任意选取的第三方页面 `https://example.com`。

## Decision

内容协议在内部保留结果和状态上的可选字符串 `id`，以及可选的顶层 `statuses[]`，其条目包含 `id?` 和 `status: 'success' | 'failed'`。相等的字符串 id 将结果与状态关联。对于此单输入调用，当结果缺失或任一 id 缺失时，唯一的状态适用；冲突的 id 不匹配。存在多个状态且无法归属时，仍由现有的去除首尾空白后的内容校验决定结果。

可归属的 `failed` 状态优先于可读内容，通过 `protocolError` 抛出 `provider / page_fetch_failed`，消息为 `Querit could not fetch page content for <trimmed input>`。请求级 `error_code` 错误保持优先。仅将具有该种类和代码的类型化 Querit `fetchUrls` 错误，在 `src/main/ipc/handlers/webSearch.ts` 中重新抛出为领域 `IpcError` `WEB_SEARCH_PAGE_FETCH_FAILED`。其他所有错误原样传播；路由保留 `Promise<void>` 成功输出。

设置钩子仅对 Querit `fetchUrls` 检测使用 `https://www.querit.ai/en/docs/overview/about`。其他远程抓取提供商保留 `https://example.com`；搜索保留 `Cherry Studio`。该领域错误显示现有失败标题，并附上新的本地化描述，指明探测页面并说明 URL 抓取功能未得到验证。

## Alternatives considered

- 将页面失败视为成功或部分连通性警告，会改变检测所承诺的成功含义：获得可用的抓取内容。
- 按数组位置匹配状态，或让任意失败状态覆盖结果，可能将其他页面的失败归到返回的结果上。
- 要求必须有 `statuses` 会破坏既有的无状态成功响应兼容性；将所有空白响应归为页面失败，则是在没有可归属失败时虚构证据。
- 修改通用 IPC 框架、公共结果类型或 `WebSearchErrorKind` 会不必要地扩大共用契约；内部关联、现有 `provider` 种类和限定范围的领域映射已足够。
- 将探测页面设为可配置项或存入共用预设/目录元数据，会为钩子拥有的单个桌面检测策略扩展设置或共用 API。

## Consequences

无状态成功响应继续有效。提供的畸形状态、`null` 或数值 id 无法通过模式校验；可选表示允许缺失，而非允许 null。Id 保持内部使用。文档示例页面只是探测页面的选择，不能证明实时爬虫在 Cherry 的 markdown 格式和默认超时请求下可靠。其他提供商和搜索检测保持不变。

## Verification

- Regression — `packages/web-search/src/__tests__/protocols.test.ts`：页面失败矩阵、id 关联、失败与请求错误的优先级、模式校验及无状态响应兼容性。
- Regression — `src/main/services/webSearch/providers/__tests__/ApiProviders.test.ts`：报告中的两种形态（失败状态搭配空内容或空结果）均通过真实适配器保留分类。
- Regression — `src/main/ipc/handlers/__tests__/webSearch.test.ts`：精确的类型化上下文映射、可序列化领域代码、无关错误原样传播及 void 成功输出。
- Regression — `src/renderer/pages/settings/WebSearchSettings/__tests__/useWebSearchProviderCheck.test.ts`：探测页面路由、真实英文插值、失败描述、检测状态清理及通用失败措辞。

Electron 提示的可见性、真实提供商的抓取能力及 Windows 行为需要单独进行运行时验证。
