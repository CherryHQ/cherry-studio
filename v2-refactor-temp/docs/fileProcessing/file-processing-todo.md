# File Processing TODO

本文记录当前 `v2-file-processing-service` PR 之后仍需要处理的 file-processing 后续工作。

主设计文档仍是 [`file-processing-service.md`](./file-processing-service.md)。本文只追踪 TODO，不重新定义接口契约。

---

## 1. 后续业务接入

这些工作不属于当前 Main-side task API 重构范围，需要拆到后续 PR。

1. Renderer / preload 正式接入 `startTask`、`getTask`、`cancelTask`。
2. 翻译 OCR 从旧 `window.api.ocr` 切到新 file-processing task API。
3. `KnowledgeService` 消费 `document_to_markdown` 的 markdown file artifact，并完成入库、chunk、embedding 联调。
4. 删除旧 `src/main/services/ocr` 和旧 preprocess provider。
5. 清理旧 i18n、设置页、migration 中不再需要的兼容逻辑。

---

## 2. 暂不实现的能力

这些能力当前有明确设计边界，不应作为本 PR 的 blocker。

1. 不建立 Renderer task subscription / IPC broadcast。
2. 不建立全局 UI task center。
3. 不新增 DataApi task table。
4. 不新增 Cache / SharedCache task mirror。
5. 不把旧 OCR IPC 桥接到新 file-processing task API。
6. 不让 file-processing task state 跨 app restart 恢复。

如果后续产品需要实时进度 UI，可以在 Orchestration 或专门的 bridge service 中订阅 `FileProcessingTaskService.onTaskChanged` 后再转发给 Renderer。

---

## 3. 代码内显式 TODO

### 3.1 Mistral MIME 解析

位置：`src/main/services/fileProcessing/processors/mistral/utils.ts`

当前 Mistral processor 内部维护了图片扩展名到 MIME 的映射。

后续方向：

1. 等统一 file management / file-type resolution 层落地后，把 MIME 推断迁过去。
2. Mistral processor 只消费统一文件层提供的 MIME 信息。

### 3.2 OV OCR 进程管理

位置：`src/main/services/fileProcessing/processors/ovocr/utils.ts`

当前 OV OCR 仍在 processor handler 内直接执行外部脚本。

后续方向：

1. 等统一 `ProcessManagerService` 或等价进程生命周期设施落地后，把进程启动、日志、超时、重启和清理交给该设施。
2. OV OCR processor 保留输入准备、输出解析和错误映射。

### 3.3 Tesseract Runtime 进程池

位置：`src/main/services/fileProcessing/processors/tesseract/runtime/TesseractRuntimeService.ts`

当前 Tesseract runtime 在 Main 进程内持有 shared worker、串行队列和 idle release。

后续方向：

1. 如果未来建立统一 `ProcessManagerService`、托管 utility process 或 worker pool，再把 worker 生命周期和并发控制迁过去。
2. 本 PR 不引入 language worker pool 或 per-task worker。

---

## 4. 推荐拆分顺序

1. 先接 Renderer / preload 的统一 task API，使新 contract 真正被业务调用。
2. 再分别迁移翻译 OCR 和 KnowledgeService markdown artifact 消费。
3. 业务链路稳定后删除旧 OCR / preprocess 代码。
4. 最后处理设置页、i18n、migration、file management、ProcessManager 这类清理和基础设施项。
