# Agent Note: 在新增知识库数据源前拒绝无效 URL

Status: implemented

[English](2026-11-07-knowledge-url-validation.md) | 中文

## Problem

知识库 URL 对话框接受任意非空字符串，`knowledge.add_items` 也未校验它。因此，提交 `not a valid URL` 会关闭对话框并保存一个只能在索引阶段失败的数据源。桌面回归 MP-62 复现了这个无法在输入处纠正的问题。

## Decision

在 `knowledge.add_items` 的 IPC 边界使用已有的 `isHttpUrl` 判定函数校验 URL 条目。格式错误或非 HTTP 的 URL 会在导入前拒绝整个请求。对话框现有的错误处理保留输入窗口并显示校验错误。有效的 HTTP 和 HTTPS URL 仍进入正常的异步抓取、索引流程，网络失败仍显示为条目错误。

不收紧持久化 URL schema 和内部恢复输入 schema。此前保存的无效数据源仍须能够读取、删除和恢复，不能因本次修复而变得不可访问。

## Alternatives considered

- 只在对话框校验，其他 IPC 调用方仍能保存无效输入。
- 收紧共享实体或恢复 schema，会在读取或恢复时拒绝已有记录。
- 校验时检查网络可达性，会将暂时的网络故障当成输入错误。

## Consequences

新增 URL 数据源必须使用绝对 HTTP 或 HTTPS URL。包含无效 URL 的混合选择整体被拒绝，用户纠正输入时不会因部分导入而重复创建数据源。这是语法校验，不是网络访问策略。

## Verification

- Regression — `src/main/ipc/handlers/__tests__/knowledge.test.ts`：格式错误和非 HTTP URL 在导入前拒绝整个批次；有效 URL 被接受；已有无效实体和内部恢复输入仍可读取。
- Regression — `src/shared/utils/__tests__/url.test.ts`：共享判定函数接受 HTTP(S)，拒绝不支持或缺少协议的地址。
