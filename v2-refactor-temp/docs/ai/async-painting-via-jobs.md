# 异步绘图迁移到 JobManager

> 更新日期：2026-05-31
> 范围：`src/renderer/aiCore/provider/custom/*`(图像 transport)、`src/main/data/services/PaintingService.ts`、`src/main/core/job/*`
> 目的：记录「aiCore 迁移到 main 之后,异步绘图改用 Job & Scheduler 实现」的设计结论与落地映射。**这是迁移后的目标设计,不是当前要实现的代码**——前提见文末。

## 结论

用 **JobManager + 一个 `painting.generate` JobHandler**,**不用** SchedulerService。

`docs/references/job-and-scheduler/overview.md` 区分得很清楚:

- SchedulerService 管「什么时候触发」(cron / interval / once,时间驱动)。
- JobManager 管「任务生命周期」(持久化 + 6 态机 + 重试 + 并发 + 重启恢复)。

异步绘图是**按需触发的后台长任务**,没有 cron,所以归 JobManager。scheduler 那半边在绘图里用不上。

## 为什么契合

`docs/references/job-and-scheduler/handler-authoring.md` 的 **§2 "Remote-poll pattern (cross-restart hand-off)"** 就是异步绘图的形状:submit 到 vendor → 持久化 `providerTaskId` → 轮询到完成。文档明确点出了那个最关键的坑:

> CRITICAL: await — without persistence the restart-recovery will re-submit the remote job, wasting user quota and producing parallel external tasks.

现有 transport 与该模式 1:1 对应,**恢复所需的钩子已经存在**:

- `dashscope/dashscopeTransport.ts`:`submit()` 返回 `{ taskId }`,并在拿到 task id 时回调 `onSubmitTaskId?.(taskId)`(`:404`);`poll(taskId, { signal })`(`:408`)。
- `ppio/ppioTransport.ts`、`aihubmix/aihubmixFlux.ts`:同样是 `submit → { taskId }` + `poll(taskId)`。

`onSubmitTaskId` 这个回调本来就是为「跨重启把 task id 交给上层持久化」而存在的——正好喂给 §2 的 `ctx.patchMetadata({ providerTaskId })`。

JobManager 在本仓已有成熟先例(`KnowledgeOrchestrationService`、`fileProcessing/tasks/*JobHandler`),不是新基建。

## 落地映射(迁移到 main 之后)

1. **JobRegistry** 增加类型:

   ```ts
   declare module '@main/core/job/jobRegistry' {
     interface JobRegistry {
       'painting.generate': PaintingGeneratePayload
     }
   }
   ```

2. **PaintingService(main,已存在)拥有它**:在 `onInit` 里 `registerHandler('painting.generate', paintingGenerateJobHandler)`(注册时机见 handler-authoring「Registration timing」——必须 `onInit`,不能 `onAllReady`),并暴露一个 IPC(如 `Painting_Generate`)→ 内部 `jobManager.enqueue('painting.generate', payload)`。Handler 放 `src/main/data/services/.../tasks/PaintingGenerateJobHandler.ts`(handler-authoring §6 约定)。

3. **Handler.execute = §2 remote-poll**:

   ```ts
   async execute(ctx) {
     let taskId = ctx.metadata.providerTaskId as string | undefined
     if (!taskId) {
       const r = await transport.submit(input, { signal: ctx.signal })
       if (r.imageUrls) return finalize(r.imageUrls)          // 同步 vendor:一次返图,无 taskId
       taskId = r.taskId!
       await ctx.patchMetadata({ providerTaskId: taskId })     // CRITICAL: poll 之前先持久化
     }
     while (!ctx.signal.aborted) {
       const urls = await transport.poll(taskId, { signal: ctx.signal })
       if (urls.length) return finalize(urls)
       ctx.reportProgress(/* … */)
       await sleep(POLL_INTERVAL_MS, { signal: ctx.signal })   // 必须 signal-aware
     }
     throw new Error('AbortError: cancelled')
   }
   ```

   `finalize` 在 main 写 `FileEntry` + `file_ref(sourceType='painting')`,与已落地的 file_ref / orphan-sweep 一致。

4. **渲染端只读观察**(overview「Renderer-side consumers」规则):`useJob(jobId)` / `useJobProgress(jobId)`。渲染端**不**直接 enqueue / cancel,只通过 PaintingService 的 IPC 发起。这替掉了现在渲染端的轮询循环和 `painting.generation.${id}` 共享 cache。

## 同步 vendor 也走同一个 job

dmxapi(openai-flat 族)/ ovms / silicon / aihubmix(非 async)/ openai 等是一次请求返图(`submit()` 返回 `imageUrls` 而非 `taskId`)。**同一个 `painting.generate` handler** 按返回的是 `taskId?` 还是 `imageUrls?` 分叉即可(见上 execute 草图),无需第二种 job 类型。这样并发、重试、可观测性对同步 vendor 同样生效,模型统一。

## 收益(相比现在渲染端 submit/poll)

| 能力 | 现状(渲染端) | 用 Job 之后 |
|---|---|---|
| **跨重启续跑** | 重启即丢,task id 没了 | 持久化 `providerTaskId`,`recovery: 'retry'` 续轮询而非重交(省配额、不产生并行外部任务)—— **杀手锏** |
| 并发控制 | 无 | per-queue + 全局 `globalMaxConcurrency` |
| 重试 / backoff | 无 | 内建,`JOB_HANDLER_THREW` / `JOB_HANDLER_TIMEOUT` 可重试 |
| 取消 | `paintingAbortControllerStore`(渲染端 Map) | Job `cancelRequested` → `ctx.signal`,transport 已吃 `AbortSignal` |
| 进度 / 可观测性 | 临时 cache | 持久化 `JobSnapshot` + `reportProgress` |

## 设计要点 / 坑

- **幂等、防重交**:`providerTaskId` 必须在第一次 `poll` **之前** `await` 持久化(§2 CRITICAL)。enqueue 带 idempotency key,防双击产生两个 vendor 任务。
- **recovery 策略**:异步 vendor 用 `retry`(续跑);execute 重入时**必须**先读 `ctx.metadata.providerTaskId` 决定续轮询而非重交。
- **轮询循环**:`while (!ctx.signal.aborted)` + `sleep(N, { signal })`,禁止 `while (true)` / 无 signal 的 `sleep`(否则取消会被拖延 N ms,见 §2 anti-pattern)。
- **文件产出**:在 main 写 FileEntry + `file_ref`,对齐现有 file_ref / orphan-sweep。

## 可退役项

迁移后这些渲染端构件可以删掉:

- `paintingAbortControllerStore`(取消改走 Job cancel)。
- `painting.generation.${id}` 共享 cache(状态改走 `useJob` / `useJobProgress`)。
- 渲染端的轮询循环(移入 handler.execute)。

## 前提与未决

- **依赖 transport 真的搬到 main**。当前 `src/renderer/aiCore/provider/custom/*` 的 transport 仍在渲染端(`src/main/aiCore` 已存在,迁移有脚手架,但 transport 尚未过去)。transport 能从 main 调用之前,这个 JobHandler 跑不起来。
- 落地时可复用已建的 boundary 测试 harness(`src/renderer/aiCore/provider/custom/__tests__/boundary/`)给 `PaintingGenerateJobHandler` 补 request/response 契约测试。

## 参考

- [`../../../docs/references/job-and-scheduler/overview.md`](../../../docs/references/job-and-scheduler/overview.md) — 架构总览、DB 驱动、Renderer 只读消费
- [`../../../docs/references/job-and-scheduler/handler-authoring.md`](../../../docs/references/job-and-scheduler/handler-authoring.md) — §2 remote-poll、注册时机、recovery × catchUp 矩阵、handler 组织约定
- [`../../../docs/references/job-and-scheduler/concurrency-and-locks.md`](../../../docs/references/job-and-scheduler/concurrency-and-locks.md) — 并发模型
- [`../../../docs/references/ai/image-generation-parameters.md`](../../../docs/references/ai/image-generation-parameters.md) — 绘图参数化架构(transport / 出参边界)
