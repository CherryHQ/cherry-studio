# Agent Note: 工具结果存储、投影与详情边界

Status: implemented

[English](2026-11-09-tool-result-projection-boundaries.md) | 中文

## Problem

用户需要在智能体持续流式输出时展开和关闭工具卡片。目前，完整工具结果仍参与只改变正文的处理。延迟传给 renderer 可以减少这类工作，但存储读取、结果投影、详情加载和交付订阅的边界仍不一致。

在本次检查的基线 `c9426d07704407106e23f03ee6aca9e3938df8ef` 上：

- `TopicMessageProjection.publish` 每批发布时都会重新投影累计消息。`projectToolOutputForRenderer` 会重新序列化并哈希大结果。
- `MessageProjection.flush` 先复制并深度比较整个新视图，再生成追加 patch。把这项成本移到 Main 并不等于增量发布。
- `useResolvedToolResponse` 在工具组件挂载时就启动 `useToolResult`。加载详情会暂时把显示的工具状态改成 `invoking`，读取失败则改成 `error`。
- `useToolResult` 用结果 revision 构造不可变缓存键，但 `ai.tool.get_result` 的请求不包含该 revision。因此，旧缓存键对应的请求可能读到替换后的值。
- 生产者尚未建立“完成状态即不可变”的契约。Pi 保留 preliminary 结果，现有投影和 hook 回归测试也明确支持同一消息、同一工具调用的结果替换。

本说明细化[运行时契约](../../proposed/architecture/2026-10-17-agent-runtime-contract.md)中的载荷和消费者边界，保留原生执行、归档所有权和有序投影交付。[PR #23873](https://github.com/CherryHQ/cherry-studio/pull/23873) 是同一栈中位于本 Spec 之上的首个存储实现层。其上的实现层建立了下述边界。最终验收仍受 Verification 中证据范围的限制。

## Decision

### 最新结果与原生内容接纳所有权

调用由会话、产品消息和工具调用共同定位。preliminary 或替换输出覆盖当前值；不保留历史输出、内容哈希、结果 revision 或版本寻址读取。`MessageProjectionUpdate.revision` 仍是用于重复检测及缺口恢复的连续交付序号。

适配器能够确定变化下标时，在原生 `message.upsert` 观察中携带 `changedParts`。`snapshotRuntimeMessage` 捕获这些下标对应的 part，并复用先前接纳且未变的 part。没有提示时捕获整条消息。接纳的 JSON 工具载荷及 part 由运行时所有者深度冻结并标记；任意对象身份或 `output-available` 本身不足以证明内容未变。元数据装饰器保留未变身份。Claude、Pi 和 Pi Durable 通过这一边界报告实际结果变化，包括 preliminary 替换。

`AcceptedToolResults` 使用现有 `snapshotToolPart` 边界，为实时根线程调用保留一份已接纳的最新值快照、紧凑 renderer part 和序列化 UTF-8 缓冲。不可变字符串共享，不在序列化后再通过 `JSON.parse` 复制。纯正文发布复用已接纳的产物。范围读取对所有者的缓冲取片段，不在每次打开时重新编码完整实时值。chunk 结果转为错误时移除旧接纳值并使其读取者失效。查找包含捕获的产品消息和实时执行身份；持久化交接成功后改读已存输出。持久化失败保留可读实时内容，不重试工具。

### 持久化字节与明确用途的读取

`AgentSessionMessageService` 在紧凑消息数据旁原子保存每个消息/调用的一份当前输出。序列化字节相同则跳过结果重写。已接纳且未变的 part 复用其序列化值；普通正文变化不重写已稳定的独立结果行。数据库层通过生成的迁移删除结果 `revision` 列。旧内联值和持久化 blob 信封仍可读取，不在启动时批量回填。已拆分消息分页和存在性检查不还原结果表；完整模型上下文、恢复、分叉、诊断及明确的全文消费者保留原有还原路径。

`ai.tool.get_result` 要求明确用途并读取最新值，忽略旧引用中的输出 revision：

| 用途 | 响应及上限 |
| --- | --- |
| `preview` | 有类型的输出及 `truncated`；序列化 UTF-8 响应不超过 32 KiB。大型图片字节改为所有者提供的 `cherry-media://tool-result/…` 资源。 |
| `text-range` | 最多 256 KiB UTF-8 文本，可附带经校验的字节游标。已拆分 SQLite 值使用有界 `substr` 读取；旧 blob 信封使用有界 FileManager chunk。旧内联值仍需经过原有完整读取。 |
| `full` | 复制、图片导出等明确操作所需的原始类型值。普通通用卡片挂载不请求它。 |

当前 handler 返回 `ready` 或 `unavailable`；协议仍支持 `pending`，消费者在相关失效或重新附着时重试。可用性不改变工具成功、执行中或失败状态。资源读取校验调用身份及受信 renderer 来源，不增加另一份媒体载荷存储，返回最新图片并使用 `no-store`。本地读取代次变化时重新挂载图片展示。全文复制和导出保留原始结果。

### 详情所有权、失效与发布

已删除提前读取全文的 `useResolvedToolResponse` 入口。通用卡片只在展开时挂载读取者，原始文本分页且每次只展示一页。关闭时分离订阅并隔离迟到完成。专用卡片、引用及活跃且依赖结果的面板使用有界类型化预览；不把详情写回流式消息 parts。

每个 renderer 只有一份按调用身份及用途/范围寻址、载荷预算为 16 MiB 的 LRU。活跃读取去重；过期请求不能重新填充当前缓存或展示。超过预算的明确全文值可以交付给已挂载请求者，但不保留在共享缓存中。这一预算不限制总 JS 堆、DOM、活跃展示对象或进程 RSS。

`MessageProjectionService` 保留实际展示结果的所有者。子线程 RPC 通过父线程寻址，但缓存所有权跟随已安装子线程归档的 `sessionId`。重新附着、交付缺口、基线替换及提交后的持久化消息通知使该所有者失效；最后一个观察者释放其保留详情，不清除其他活跃观察者的数据。迟到附着不能安装过期所有者。

结果变化作为定向 `tool-result` patch 随现有有序批次交付，即使紧凑 part 没有变化也如此。renderer 先校验更新，再使详情失效并通知消息消费者。已覆盖的 revision 不重复触发失效。范围失效后分页从字节零重新开始；游标不固定历史版本。

发布复用已接纳且未变的消息和 part，只发受影响的追加或替换 patch，仅在成员或顺序变化时包含 `order`。renderer 工具消费者订阅自己的 part，因此无关正文不会更新每张已稳定卡片。根线程和子线程的运行时生命周期、滚动所有权、关闭排空及持久化失败语义仍由既有所有者管理。

## Alternatives considered

- 为旧输出引用保留历史结果或内容 revision。拒绝，因为全部消费者需要的是最新值或明确的全文读取，而非过去的结果。同调用结果替换需要缓存失效，不需要版本寻址存储。
- 增加结果计数器、内容哈希或新输出 ID 来使缓存失效。拒绝，因为现有有序投影交付可以携带定向失效，不需要另一套持久化身份。
- 每次投影都哈希完整结果，或通过更多 memoization 将全文保留在 renderer 消息中。拒绝，因为未变化内容仍产生复制、序列化或比较成本。
- 增加 DataApi 超时，或始终先还原全文再截断预览。拒绝，因为两者都不能约束同步工作量。
- 采用 T3 的整套事件日志和 turn-item 存储模型。拒绝，因为 Cherry 已拥有运行时投影、patch 交付和历史。本提案采用更小的边界。
- 在新契约旁保留旧内部读取 API。拒绝，因为进程内调用方可以一起迁移。需要兼容的是持久化记录，不是已被替代的 renderer API。

## Consequences

- Main 在拥有活跃结果期间保留接纳快照和序列化缓冲。这消除了重复投影和范围处理；序列化缓冲仍有 Main 常驻成本，已接纳的不可变字符串则共享。持久化交接成功后清除接纳结果所有权；持久化失败时保留以便恢复。
- 全文读取及旧内联兼容路径仍可能分配或解析完整值。缓存预算和响应上限不代表总内存上限，也不保证任意大结果的响应速度。
- 大型结构化消费者可能因预览上限丢失字段。必要展示需要有类型且有界的预览或资源读取器，不能使用无上限的通用绕过路径。
- 最新值范围有意不提供跨读取的历史一致性；通过替换失效和本地请求隔离重置视图。
- 可变原生来源必须准确报告变化下标。缺少提示时完整捕获；完成显示状态不能替代接纳契约。
- 迁移冲突通过针对实际基线重新生成未发布层解决，保留已发布迁移和已有数据。不要求启动重写或删除数据库。
- 实测 Electron 夹具使用 macOS production 未打包构建，不能证明 Windows/Linux、打包发行版、任意提供商或无限时长的无泄漏验收。单独真实智能体运行已成功；最终构建无需再次调用模型即可恢复并读取其已完成的持久化结果。

## Verification

- AC1 — `AcceptedToolResults.test.ts` 验证可变来源分离、同调用替换及已稳定输出不再序列化；`observation.test.ts` 和原生投影测试覆盖不可变接纳与变化下标。共享快照调整后，明确的 Main 命令通过 5 文件 247 测试。core runtime 通过 15 测试，Claude 21、Pi 21、Durable 8；确切命令和工作目录记录在 `native-test-evidence.md`，依据所有者的工具记录，不虚构磁盘日志。
- AC2 — 数据库层 #23873 通过 12 个明确 Main 文件的 284 测试，包含已有数据前向迁移、紧凑分页/全文读取和级联清理。实现层修改后的最终 `AgentSessionMessageService.test.ts` 通过 89 测试。迁移链检查通过。
- AC3 — `ToolResultService.test.ts`、`useToolResult.test.ts` 和 `MessageProjectionService.test.ts` 覆盖 A/B 替换、迟到完成、pending/重新附着及所有者/缺口/基线失效；最终子线程缓存所有者回归通过 5 测试。Electron `functional.json` 确认替换使已展开范围失效并重置分页。不提供历史结果读取。
- AC4 — Renderer `MessageTools.test.tsx`、`MessageMcpTool.test.tsx` 和 `AgentToolRenderer.test.tsx` 覆盖折叠卡片读取、展开关闭及执行状态保留；受影响 UI/导出命令通过 12 文件 282 测试，修改 UI 的重跑通过 4 文件 69 测试。Electron 夹具校验每次展开显示该工具自己的当前正文。
- AC5 — `toolResultRead.test.ts`、handler 和存储测试覆盖 UTF-8 上限、游标校验、有界 SQLite 读取及旧 blob chunk。最终 API/接纳命令通过 3 文件 70 测试；子线程/范围命令通过 2 文件 23 测试。Electron 记录预览序列化 8,388 字节、单页 262,144 字节且下一游标 524,288，并通过 CSP 显示 32×32 资源图片。
- AC6 — `ToolResultService.test.ts` 覆盖 16 MiB 序列化字节 LRU、超限全文不保留、关闭/重开隔离及共享所有者释放；子线程所有者回归保留父线程与其他消费者。最终五轮各打开八个会话、关闭夹具标签并 GC 后，renderer 堆 90.0 → 60.3 MiB，Main 堆 147.2 → 147.0 MiB、external 20.9 → 37.0 MiB、RSS 342.8 → 327.2 MiB；DOM Nodes 3779 → 6035。新版同调用 2 MiB 结果第 5–20 次替换，renderer 堆保持 62.8–62.9 MiB，Nodes 为 6346，没有意外关闭后重开卡片。这些有限检查不证明无限时长无泄漏或总内存上限。
- AC7 — 12 文件 282 测试的 renderer 命令覆盖专用/引用/图片卡片、子线程面板及 markdown 导出；数据库层全文读取覆盖上下文、恢复、分叉和诊断。Electron 验证明确的 16 MiB 全文结果、图片显示及同调用替换。单独真实智能体通过 `deepseek::deepseek-flash` 在 6.820 s 完成：恰好一次 `read` 调用达到 `output-available`，972 字符的回复包含要求的 sentinel。一次提供商/工具运行不能覆盖全部消费者或平台。
- AC8 — Main 根线程/子线程/消息投影、ThreadFeed/原生包及 renderer 投影测试覆盖已接纳稳定 part、有序 patch、重复/缺口恢复、替换和持久化屏障。明确的 Thread/重新附着/catalog 命令通过 3 个 Main 文件 29 测试；子线程 topic 前缀修复后的子线程/范围重跑通过 2 文件 23 测试；子线程 renderer 所有者回归通过 5 测试。最终共享快照 Main 测试通过 5 文件 247 测试。该调整后的 Node 类型、定向 lint 和 production/utility 构建通过；先前 web/类型/文档门禁仍适用于未变化部分。未运行完整本地测试集。
- AC9 — 两侧 production 产物交替运行五轮；每轮在 30 ms 文本更新下，对 256 KiB、2 MiB、16 MiB 已稳定结果各实际展开关闭二十次。新版各轮 p95 范围依次为 80.0–94.1、78.5–93.6、80.0–88.5 ms，均符合 100 ms。最终矩阵及独立 renderer trace 均未出现 ≥50 ms renderer 任务。16 MiB 下 Main CPU 中位数为 193.4 → 50.4 ms/s，基线 crypto 哈希/序列化热点未出现在最终 profile。单独 DeepSeek 智能体在 6.820 s 完成一次真实 read；最终构建恢复了其持久化输出。中间构建曾记录未归属的 55 ms 任务，不声称其原因已修复。基线已有 defer；Main/renderer 产物分别冻结，外置原生 runtime 包由两侧共享，夹具不经过它们。正文可见时间包含旧挂载/高亮等待；两侧容器 p95 均约 14–16 ms。
- AC10 — 来源审计确认删除提前读取全文的入口及输出 revision 键，全部内部读取迁移为明确用途。双语 triplet 只在此最终层移动为 implemented；配对、针对已批准 Spec head 的转换、改动文件格式与文档检查通过。性能报告区分固定夹具、真实智能体运行、Main 保留缓冲、较高 DOM 计数及未覆盖平台。

最终夹具证据记录在 `.context/cherry-electron-dev/summary.json`，并附 `functional.json`、配对 metrics/memory 文件及 CPU/renderer 轨迹。已替代的中间测量单独保存在 `pre-shared-snapshot/`。`build-metadata.json` 记录基线 `78d2cea7949868d669c8ceb26f1f3dad78555140`、可执行来源指纹 `6ccb768b6f347a17bd06e439b776729ac7a579661934d6d170745c699f266058` 及 after-Main SHA-256 `5675f21813198fa8c549d4f656951191a9d30064df04bfcd7ad37213592d01fe`。该基线已经包含 defer。Apple M5、10 核、32 GiB、Electron 45.2.2；production 加 utility-process，未打包，960×600 视口、设备缩放因子 2。renderer 堆、DOM、Main heap/external 及进程 RSS 分别报告；缓存预算不是总内存上限。正文可见时间包含旧读取器的延迟挂载/高亮行为，不是纯序列化基准。
