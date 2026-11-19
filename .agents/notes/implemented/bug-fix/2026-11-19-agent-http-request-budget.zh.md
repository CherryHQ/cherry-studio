# Agent Note: 限制图片密集型智能体 HTTP 请求的并发

Status: implemented

[English](2026-11-19-agent-http-request-budget.md) | 中文

## Problem

并发的 Claude Agent 请求可能耗尽 Electron 主进程的 V8 堆。包含历史图片的请求同时进入网关转换和提供商请求编码时，会推高内存占用。[Pi 切换到对象传输](../architecture/2026-11-18-agent-object-transport.md)后，Claude Agent 仍使用内部 HTTP。

## Decision

发往 `POST /v1/messages` 的内部智能体会话请求在转换前共用 32 个一 MiB 额度。按 HTTP 请求内容长度向上取整计入额度，最多占用全部额度。长度未知的请求占用全部额度。请求完成、失败或断开时释放额度。排队请求取消时立即移出队列，并用剩余额度重新判断下一项能否执行。

## Alternatives considered

- 按固定请求数限流会让小型文本请求和图片历史较大的请求占用相同额度。
- 裁剪历史或缩小图片会改变模型能核对的内容。

## Consequences

大请求可能等待额度，完整历史会保留。公开请求和 Pi 对象传输绕过 HTTP 额度。额度约束同时进行的下游处理。HTTP 请求体在准入前解析，仍会占用内存。

## Verification

- Regression — `ApiGatewayService.test.ts`、`proxyStream.stream.test.ts` 和 `routes.integration.test.ts` 覆盖加权排队、取消、流完成和断开，以及内部会话的适用边界。
- Regression — 使用恢复的用户数据和本地模型 mock，macOS Electron 开发版完成了 26 分钟的图片读取长测，以及单独一轮包含图片、命令和流式文本的测试。每轮最多有 20 路子智能体并发，全程未发生 OOM。Windows 安装包和完整历史会话仍待验证。
