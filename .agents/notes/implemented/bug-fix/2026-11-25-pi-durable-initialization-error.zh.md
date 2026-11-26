# Agent Note: 保留 Pi Durable 初始化诊断

Status: implemented

[English](2026-11-25-pi-durable-initialization-error.md) | 中文

## Problem

当 Pi Durable 无法初始化原生存储或 Harness 时，运行时会记录原因供诊断，并返回通用的初始化错误。工作对话在建立响应流后收到该错误，聊天错误分类因此可能提示用户检查网络。[议题 #25353](https://github.com/CherryHQ/cherry-studio/issues/25353)

## Decision

运行时结果保留 `initialize` 操作、`native-error` 错误码和可用的原因文本。桌面端后端屏蔽凭据并限制消息长度，再抛出带有通用序列化标记 `errorSource: 'local'` 的初始化错误。聊天根据该标记采用现有通用标题，并在旁边展示诊断信息。本地文本（包括 `[SQLITE_BUSY]` 这类带方括号的原生错误码）在两处边界均绕过服务商载荷解析，同时保留脱敏和长度限制。服务商错误继续使用现有载荷过滤和诊断。

## Alternatives considered

- 根据报错文案分类会使渲染进程依赖特定文本，也可能把包含「超时」的本地故障指向网络设置。
- 修改所有未知错误的响应流兜底规则会影响其他服务商连接中断。

## Consequences

工作对话会显示本地初始化故障的操作、错误码和可用原因。

## Verification

- 回归验证 — 模拟原生存储工厂失败，验证运行时保留操作、错误码和原因文本。覆盖 Error、字符串与无法提取文本的对象。
- 回归验证 — 原生 Harness 初始化失败经过桌面端后端和序列化后，仍保留带方括号的原因及本地标记。序列化测试覆盖凭据脱敏、长度限制和标记白名单。
- 回归验证 — 错误卡测试渲染序列化后的本地诊断，包括 `[SQLITE_BUSY]` 和超时文本，且不会显示网络或响应流中断提示。渲染进程的文本测试保留服务商载荷过滤。
