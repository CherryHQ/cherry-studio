# Agent Note：通过 MinerU 4.1 Tasks API 解析文档

Status: implemented

[English](2026-11-18-open-mineru-tasks.md) | 中文

## 问题

MinerU 4.1 保留 `/v1/health`，但用 Tasks 替换了 4.0 的 Upload/Jobs 协议。仅接受新健康字段，会让正常部署变得可选，却依然无法解析文档。[4.1 迁移契约](https://github.com/opendatalab/MinerU/blob/mineru-4.1.3-released/docs/en/reference/migration_4_1.md) 明确移除了旧端点，没有提供旧协议回退。

## 决定

只有健康响应声明本地上传及默认输出包时，才识别为 Tasks。保留旧版 `/file_parse` 和 4.0 Upload/Jobs 客户端。领域内的 Tasks 客户端创建单文件 JSON 清单，在上传前保存任务标识，持续查询同一任务，并复用现有流式 ZIP 读取器读取已完成结果中的 Markdown。

恢复数据通过 `tasks` 区分现有 `v1` 任务，仅包含端点和任务标识。凭证读取当前设置；上传和结果地址重新从任务详情获取。创建操作不自动重试。上传和下载保留 URL 校验、DNS 固定和 API Key 同源限制。现有任务取消及重启策略保持不变；适配器可以恢复已有元数据，但不会启用跨重启的自动任务恢复。

## 备选方案

- 放宽健康校验但不实现 Tasks，无法解决报告中的解析失败。
- 替换 4.0 客户端会破坏现有部署及已保存的 4.0 任务元数据。
- 将裸 ZIP 地址交给通用持久化层会丢失服务商的鉴权要求。

## 后果

兼容的 4.1 部署可以解析本地文档。失败、取消、不完整、标识不符和已过期的任务不会成为成功的文档产物。ZIP 处理使用临时文件，不会将整个压缩包缓冲到内存。PDF 识别质量及模型可用性仍由所配置的 MinerU 服务负责。

## 验证

- Regression — 定向 Open MinerU 协议、Tasks、旧版、V1 和处理器测试验证协议选择、上传顺序、恢复行为、无效响应、凭证边界和 ZIP 提取。
- Regression — 本地官方 `mineru==4.1.3` 通过 Electron 文件处理 IPC，将包含中文和表格的 DOCX 及文本 PDF 解析并保存为 Markdown；错误 API Key 返回 HTTP 401，配置正确密钥后完成解析。
