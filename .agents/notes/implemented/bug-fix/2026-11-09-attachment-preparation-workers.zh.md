# Agent Note: 将附件准备的 CPU 工作移出主进程

Status: implemented

[English](2026-11-09-attachment-preparation-workers.md) | 中文

## Problem

纯文本提取在 Electron 主进程解码完整附件。提取后，`allocateInlineCaps` 对每个正文精确分词，再反复对前缀分词以寻找最大截断位置。提取缓存省掉解码，却省不掉预算计算。包含十一个 5 MiB 文本附件和一张 PNG 的合成 Chat 在渲染进程仍可响应时，复现了主进程事件循环阻塞数秒。这是独立复现出的阻塞机制，并不证明 #21956 原始 Windows 会话进入问题的根因。

## Decision

FileManager 负责读取，主进程保留按内容版本索引的提取缓存。纯编码辅助函数位于 `utils/textEncoding.ts`，由现有文件辅助函数和附件 worker 共用。纯文本解码及附件预算分配使用短生命周期的 `?nodeWorker` 线程。共享队列最多允许两个存活 worker；完成和失败会释放 worker，运行中的取消会终止它，排队中的取消跳过创建，不会提前释放其他任务的并发名额。解码诊断回传至集中日志服务。

附件分配器使用 UTF-8 字节数作为普通字节 BPE token 的保守上界。小正文完整保留，大正文共享现有请求预算池的剩余额度。沿码点向前扫描来选择能放入预算的前缀。附件预算不再运行精确 BPE 或反复搜索前缀。历史、系统和工具定价仍负责确定预算池，截断偏移仍采用 UTF-16 位置，供 `read_file` 分页使用。

## Alternatives considered

- 在 worker 保留精确计数：仍有不必要的工作，缓存文本也会反复产生等待。
- 仅限制单文件大小：多个未超限文件仍会在 token 分配时长时间占用主进程。
- Utility process：这类纯 CPU 工作不需要原生崩溃边界或独立环境；仓库已有的 worker thread 方式开销更小。

## Consequences

保守定价可能减少内联内容，尤其是 ASCII 正文和容易压缩的文本。支持工具调用的模型仍可使用现有续读工具；其他模型收到截断后的前缀。源字节读取、完整提取文本缓存、PDF/Office 解析，以及历史、系统和工具计数不在本次 CPU 路径修复范围内。worker 启动与结构化克隆仍有可测开销，取消也不会取消 FileManager 现有的读取操作。

## Verification

- Regression — 六个定向 main 测试文件覆盖字节预算守恒、Unicode 截断、大文本、提取兼容性、路由、分页、worker 失败、运行及排队取消，以及两个 worker 的并发上限：112 项测试通过。
- Electron — 一组冷启动前后对比通过：十一个 5 MiB 异常旧编码文本附件和一张 PNG，通过本地 OpenAI 兼容服务、真实 FileManager 条目、UI 发送和 SQLite 持久化；出站请求包含十一段截断附件文本和一张图片。
- Performance — 这一组 macOS 开发环境测得主进程最大事件循环延迟 4052 ms → 176 ms、响应耗时 6900 ms → 3401 ms，以及独立旧版 3 秒探针超时 4 → 0。CPU profile 将移出的主进程工作定位到解码及附件 BPE。这不是统计基准、打包验证、真实服务商测试或 Windows 系统未响应验收。
