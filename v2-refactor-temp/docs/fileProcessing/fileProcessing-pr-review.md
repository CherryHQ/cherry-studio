# 文件处理重构 PR 审查报告

> **PR:** CherryHQ/cherry-studio #12557
> **标题:** (WIP): Refactor File Processing
> **目标分支:** v2
> **统计:** 102 个文件，+8,035 / -2,486 行
> **审查日期:** 2026-01-26

---

## 执行摘要

此 PR 是一次重大重构，将 OCR 和文档预处理系统统一为单一的模块化文件处理架构。主要变更包括：

- 用 v2 DataApi + Preference 系统替换 Redux/Dexie
- 将 UI 从 antd 迁移到 Shadcn/Tailwind
- 引入基于轮询的异步任务处理模型

---

## 严重问题（3 个）

### 1. `convertRequested` Set 内存泄漏

**位置:** `src/main/services/fileProcessing/providers/api/Doc2xProcessor.ts:56,317`

**问题描述:** `convertRequested` Set 用于跟踪哪些任务已请求转换，但只在显式成功或失败路径上清理。如果任务启动后 `getStatus()` 从未被调用（例如客户端放弃请求、网络分区或通过 TTL 驱逐任务），UID 将永远保留在 Set 中。

**影响:**
- 长时间运行的服务器中内存会无限增长
- 被放弃任务的 UID 会无限泄漏
- 发生时没有监控或日志记录

**建议:** 为 `convertRequested` Set 实现基于 TTL 的清理，或将清理绑定到 `FileProcessingService` 中的任务生命周期。

---

### ✅ 2. 任务驱逐静默丢失结果

**位置:** `src/main/services/fileProcessing/FileProcessingService.ts:46-47,290-315`

**问题描述:** 5 分钟 TTL 清理（`TASK_TTL_MS = 5 * 60 * 1000`）在完成后驱逐任务，没有任何用户通知。如果客户端遇到网络问题且无法在 5 分钟以上进行轮询，其已完成的结果将被静默删除。驱逐特定任务时不会创建日志条目。

**影响:**
- 用户的任务成功完成但被驱逐时会收到 "not_found" 错误
- 无法区分"任务从未存在"和"任务已完成但被清理"
- 慢速文档处理期间的网络故障可能导致合法结果丢失

**建议:**
1. 记录每个被驱逐的任务及其 requestId 和最终状态
2. 在响应中区分 "not_found" 和 "expired"
3. 考虑对大型文档使用更长的 TTL 或用户可配置的 TTL

---

### ✅ 3. API 密钥非空断言不安全

**位置:** 多个文件 - 模式在各处理器中重复

- `providers/api/Doc2xProcessor.ts:256,294`
- `providers/api/MineruProcessor.ts:207,244`
- `providers/api/MistralProcessor.ts:54`

**问题描述:** 所有 API 处理器都使用 TypeScript 非空断言运算符 `this.getApiKey(config)!`。如果 `apiKeys` 为空或未定义，这将传递 `undefined` 作为 API 密钥，导致下游出现难以理解的认证失败，而不是清晰的配置错误。

**影响:**
- Authorization header 将是 `Bearer undefined`
- API 将返回通用的 401/403 错误，而不是清晰的"未配置 API 密钥"消息
- 堆栈跟踪将指向 HTTP 层，而不是配置层

**建议:** 在使用前验证 API 密钥是否存在并抛出描述性错误：

```typescript
const apiKey = this.getApiKey(config)
if (!apiKey) {
  throw new Error(`${this.id} 处理器需要 API 密钥。请在设置 > 文件处理中配置。`)
}
```

---

## 重要问题（9 个）

### ✅ 4. `getStatus()` 中的 Catch 块隐藏错误区分

**位置:** `Doc2xProcessor.ts:353-361`

**问题:** catch 块捕获所有错误并以 `status_query_failed` 代码返回。这隐藏了以下区分：
- 网络错误（重试可能有帮助）
- 认证错误（API 密钥问题）
- 文件下载错误（存储问题）
- ZIP 提取错误（文件损坏）

**建议:** 捕获特定错误类型并分配适当的错误代码。

---

### ✅ 5. 重试清理中的空 Catch 块

**位置:** `OpenMineruProcessor.ts:117-119`

**问题:** 重试循环中的清理代码有一个空 catch 块，静默忽略文件删除错误。

```typescript
try {
  fs.unlinkSync(zipPath)
} catch {
  // 忽略清理错误  <-- 空 CATCH 块
}
```

**建议:** 记录清理错误及适当的上下文。

---

### ✅ 6. `processOcrResponse` 静默返回部分数据

**位置:** `MistralProcessor.ts:160-162`

**问题:** 当 OCR 响应处理期间图片提取失败时，错误被记录但处理继续。这意味着用户得到的是部分结果，没有任何指示表明某些图片失败。

**建议:** 跟踪失败的图片并包含在结果元数据中，或在关键图片失败时抛出异常。

---

### ✅ 7. `executeProcessing` 在更新任务状态前不记录错误

**位置:** `FileProcessingService.ts:192-198`

**问题:** 当处理失败时，错误被捕获到任务状态中但从未记录。Sentry 永远看不到这些错误，使生产调试变得不可能。

**建议:** 在更新任务状态前记录错误：

```typescript
} catch (error) {
  logger.error('处理失败', {
    requestId,
    processorId: processor.id,
    error: error instanceof Error ? error.message : String(error)
  })
  // ... 其余错误处理
}
```

---

### ✅ 8. `parseProviderTaskId` 捕获并重新抛出时丢失详情

**位置:** `MineruProcessor.ts:151-161`

**问题:** catch 块捕获所有 JSON 解析错误和"缺少字段"错误，但丢失原始错误详情。格式错误的 providerTaskId 显示为"Invalid provider task id"，没有任何指示说明哪里出错。

**建议:** 保留原始错误上下文。

---

### ✅ 9. Tesseract Worker 错误处理器不向用户暴露错误

**位置:** `TesseractProcessor.ts:74`

**问题:** Tesseract worker 有一个记录错误的错误处理器，但这些错误不会传播到调用代码。Worker 初始化或处理错误可能被记录，但操作仍可能挂起或返回不正确的结果。

---

### 10. 处理器实现测试覆盖率为 0%

**位置:** `src/main/services/fileProcessing/providers/` 下所有文件

**问题:** 以下处理器没有测试：
- `Doc2xProcessor.ts` (363 行)
- `MineruProcessor.ts` (298 行)
- `MistralProcessor.ts` (210 行)
- `OpenMineruProcessor.ts` (157 行)
- `PaddleProcessor.ts` (141 行)
- `TesseractProcessor.ts` (175 行)
- `OvOcrProcessor.ts` (186 行)
- `SystemOcrProcessor.ts` (103 行)

**建议:** 至少为 Doc2x 和 MinerU 添加测试（复杂的多步骤工作流）。

---

### 11. 任务 TTL 清理机制未测试

**位置:** `FileProcessingService.ts:282-315`

**问题:** `cleanupExpiredTasks()` 方法负责在 TTL 过期后移除已完成的任务，但没有测试。

---

### 12. `useFileProcess` Hook 缺少验证

**位置:** `src/renderer/src/hooks/useFileProcessors.ts:121`

**问题:** 在处理轮询结果的 `useEffect` 中，当状态为 'completed' 时访问 `resultData.result` 没有检查它是否存在：

```typescript
if (resultData.status === 'completed') {
  callbacksRef.current.resolve(resultData.result!)  // 非空断言
}
```

**建议:** 添加空检查。

---

## 文档问题（3 个）

### 13. TTL 注释不匹配

**位置:** `FileProcessingService.ts:46-49`

```typescript
/** TTL for completed/failed tasks before cleanup (1 minute) */
const TASK_TTL_MS = 5 * 60 * 1000
```

**问题:** 注释说"1分钟"但代码是 5 分钟。

---

### 14. 注释声称未实现的功能

**位置:** `ConfigurationService.ts:20-28`

**问题:** 类级注释提到"配置变更通知"作为提供的功能，但没有实现通知/订阅机制。

---

### 15. 注释声称未实现的方法

**位置:** `ProcessorRegistry.ts:17-18`

**问题:** 注释说"按能力查找（feature + input type）"但没有这样的方法存在。

---

## 类型设计建议（5 个）

### 16. `ProcessResultResponse` 应使用可辨识联合类型

**位置:** `packages/shared/data/types/fileProcessing.ts`

**当前:**
```typescript
export interface ProcessResultResponse {
  requestId: string
  status: ProcessingStatus
  progress: number
  result?: ProcessingResult
  error?: ProcessingError
}
```

**建议:**
```typescript
type CompletedResponse = {
  requestId: string
  status: 'completed'
  progress: 100
  result: ProcessingResult
}

type FailedResponse = {
  requestId: string
  status: 'failed'
  progress: number
  error: ProcessingError
}

type ProcessResultResponse = PendingResponse | ProcessingResponse | CompletedResponse | FailedResponse
```

---

### 17. `FeatureCapability` 允许语义无效组合

**位置:** `packages/shared/data/presets/fileProcessing.ts`

**问题:** 类型允许 `text_extraction` 配合 `markdown` 输出，这在语义上是无效的。

---

### 18. `FileProcessorOptions` 丢失类型安全性

**位置:** `packages/shared/data/presets/fileProcessing.ts`

**问题:** `Record<string, unknown>` 不提供编译时安全性。

**建议:** 考虑按处理器类型使用泛型。

---

### 19. 空 `capabilities` 数组在类型上有效

**位置:** `FileProcessorTemplate`

**建议:** 使用 `NonEmptyArray<T>` 类型。

---

### 20. 错误代码应枚举

**位置:** `types/fileProcessing.ts`

**建议:**
```typescript
type ProcessingErrorCode =
  | 'cancelled'
  | 'not_found'
  | 'processing_error'
  | 'invalid_provider_task_id'
  | 'status_query_failed'
```

---

## 测试覆盖率缺口

| 领域 | 覆盖率 | 优先级 |
|------|--------|--------|
| 处理器实现（Doc2x、MinerU 等） | **0%** | 严重 |
| 任务 TTL 清理 | 未测试 | 高 |
| API 密钥验证/缺失场景 | 未测试 | 高 |
| 网络超时场景 | 未测试 | 中 |
| 并发请求 | 未测试 | 中 |
| 集成测试（handler → service → processor） | 未测试 | 中 |

---

## 优点

1. **清晰的插件架构** - 新处理器只需继承基类 + 注册即可
2. **符合 CLAUDE.md 规范** - 使用 Shadcn/Tailwind、loggerService、DataApi/Preference
3. **良好的接口设计** - 遵循接口隔离原则
4. **分层预设模式** - 模板 + 覆盖 → 合并配置设计良好
5. **提供类型守卫** - 运行时类型收窄
6. **核心编排测试良好** - `FileProcessingService` 有 70+ 个测试用例
7. **符合 v2 架构** - 无 Redux/Dexie，正确集成 DataApi

---

## 建议操作

### 合并前（严重）

- [ ] 修复 `Doc2xProcessor.convertRequested` 内存泄漏
- [ ] 使用前添加 API 密钥验证
- [ ] 改进任务驱逐日志

### 合并前（重要）

- [ ] 在更新任务状态前记录处理错误
- [ ] 至少为 Doc2x 和 MinerU 处理器添加基本测试
- [ ] 修复 TTL 注释以匹配实际的 5 分钟值

### 合并后（建议）

- [ ] 考虑为 `ProcessResultResponse` 使用可辨识联合类型
- [ ] 添加网络超时/重试测试
- [ ] 将错误代码枚举为联合类型
- [ ] 删除注释中声称但未实现的功能

---

## 验证命令

```bash
# 运行测试
pnpm test:main
pnpm test:renderer

# 类型检查和代码检查
pnpm build:check
```
