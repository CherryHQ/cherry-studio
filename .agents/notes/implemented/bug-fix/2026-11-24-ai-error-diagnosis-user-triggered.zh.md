# Agent Note：AI 错误诊断改为用户触发并受隐私开关约束

Status: implemented

[English](2026-11-24-ai-error-diagnosis-user-triggered.md) | 中文

## 问题

`ErrorBlock` 在 `useEffect` 中自动发起 AI 诊断，固定发往受管的 `cherryai::qwen` 模型，并且完全不检查 `app.privacy.data_collection.enabled`。只配置自有提供商并关闭了数据收集的用户，在收到失败消息时，错误正文仍会被发给 CherryAI（[#25217](https://github.com/CherryHQ/cherry-studio/issues/25217)，关联 [#18788](https://github.com/CherryHQ/cherry-studio/issues/18788) 与 [#13419](https://github.com/CherryHQ/cherry-studio/issues/13419)）。

## 决策

诊断只在用户点击按钮后运行，并通过主进程的 `ai.text.generate` 路由发往用户的默认模型，同时设置 `disableTools` 与 `maxRetries: 0`。数据收集关闭时不渲染入口；`errorDiagnosis` 在解析模型之前和发出请求之前各校验一次隐私开关，不通过就直接失败（fail-closed）。一小时诊断缓存一并删除，否则点击会命中旧摘要并绕过开关。

## 考虑过的替代方案

- 保留自动诊断，只更换模型。这仍会在用户没有主动要求时发出请求。
- 只加隐私开关。请求仍固定发往 CherryAI，与 #13419 冲突。
- 继续使用独立的免登录模型。不采用，因为本次改动不新增服务端依赖。

## 影响

已知代价：默认模型往往就是刚刚报错的提供商，所以诊断在最需要时可能同样失败。这是采纳 #13419「诊断应走默认模型」的结果。诊断不再产生 `cherryai::qwen` 用量。`diagnoseError` 目前没有生产调用点，本次一并去掉其中的硬编码发送方。

## 验证

- Regression — `ErrorBlock.test.tsx` 覆盖隐私与点击的组合、诊断进行中的状态，以及数据收集关闭后已有摘要被隐藏；`errorDiagnosis.test.ts` 覆盖解析模型前后的两次隐私校验，以及默认模型缺失或被禁用、提供商被禁用的分支。
- Regression — Electron 层探针观察到：数据收集关闭时没有入口，请求为 0 次；数据收集开启时静置 12 秒请求为 0 次，点击后只发出 1 次请求，且使用的是默认模型。
