# File Processing TODO

本文记录当前 `v2-file-processing-service` PR 之后仍需要处理的 file-processing 后续工作。

主设计文档仍是 [`file-processing-service.md`](./file-processing-service.md)。本文只追踪 TODO，不重新定义接口契约。

---

## 1. 后续业务接入

这些工作不属于当前 Main-side job API 重构范围，需要拆到后续 PR。

1. Renderer / preload 正式接入 `startJob`、`getJob`、`cancelJob`。
2. 翻译 OCR 从旧 `window.api.ocr` 切到新 file-processing job API。
3. 删除旧 `src/main/services/ocr` 和旧 preprocess provider。
4. 清理旧 i18n、设置页、migration 中不再需要的兼容逻辑。

---

## 2. 暂不实现的能力

这些能力当前有明确设计边界，不应作为本 PR 的 blocker。

1. 不建立 Renderer job subscription / IPC broadcast。
2. 不建立全局 UI job center。
3. 不新增 DataApi job table。
4. 不新增 Cache / SharedCache job mirror。
5. 不把旧 OCR IPC 桥接到新 file-processing job API。

如果后续产品需要实时进度 UI，应复用统一 JobManager progress 机制或建立通用 job bridge。

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

1. 先接 Renderer / preload 的统一 job API，使新 contract 真正被业务调用。
2. 再迁移翻译 OCR。
3. 业务链路稳定后删除旧 OCR / preprocess 代码。
4. 最后处理设置页、i18n、migration、file management、ProcessManager 这类清理和基础设施项。
