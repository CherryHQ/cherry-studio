# Agent Note：下载 Gemini 中转服务返回的图片 URL

Status: implemented

[English](2026-11-23-gemini-image-file-data.md) | 中文

## 问题

[#25121](https://github.com/CherryHQ/cherry-studio/issues/25121) 报告 Gemini 兼容中转服务会以 `inlineData` 或 `fileData.fileUri` 返回图片。锁定版本的 Google SDK 只收集内联图片字节，因此仅含图片 URL 的成功响应到达绘图页时会变成空结果。

## 决策

扩展现有 Google SDK 补丁，让 Gemini 图像模型从所选响应候选中提取 HTTP(S) 图片 URL。AI SDK 在持久化前通过图片下载回调处理这些 URL。Google 图片下载使用共享的公网请求工具，固定经校验的 DNS 地址，逐次校验重定向，并支持取消和字节上限。如果所有结果都因下载失败而丢失，绘图页显示本地化下载错误。

## 考虑过的替代方案

- 解析文本中的图片链接会依赖模型可选输出的 Markdown。
- 在 Google SDK 内部下载会绕开应用的下载策略，并重复媒体处理逻辑。

## 影响

内联图片和其他服务商的下载沿用现有路径。Google 图片 URL 采用与远程工具图片预览相同的直连公网策略。升级 Google SDK 时需重新检查本地补丁。

## 验证

- 回归 — 补丁前，模拟中转响应触发 `No image generated`。
- 回归 — 4 个定向 Vitest 文件共 194 项通过，覆盖仅 URL、仅内联和混合 Gemini 响应、下载错误映射、受限下载调用和图片 IPC 处理器。
- 测试使用响应夹具，未连接真实中转服务。
