# 工具结果 DB 副本裁剪(#16786)与 FileManager 引用式 GC

> 更新日期:2026-08-02(已实施,见文末「实施结论」)
> 范围：`src/main/ai/runtime/aiSdk/params/features/contextBuild.ts`、`packages/aiCore/src/core/context/*`(vendored)、`src/main/services/VfsBlobService.ts`、`src/main/data/services/MessageService.ts`、`src/main/services/file/*`、`src/shared/data/types/message.ts`、`src/shared/data/types/file.ts`
> 目的：记录「现在就做 message.data 大工具结果裁剪」前提下,blob 存储从 VFS 临时目录迁到 FileManager、GC 从 TTL 改为引用式的设计结论。

## 前提翻转

今天的双副本结构里,VFS 临时文件是**可再生缓存**:`message.data` 存全量,截断中间件每次请求重算,`vfs_<sha256>.txt` 被清掉会在下一次请求自动重写。所以 7 天(或 30 天)TTL 只是磁盘旋钮,无正确性影响。

一旦裁剪 DB 副本落地,`message.data` 只剩 head/tail + marker,**blob 成为被截断内容的唯一副本**:

- TTL 式清理 = 不可恢复的数据丢失(UI 展开失败、fs_read 读回失败);
- 「每 30 天清理」的原始需求被**引用式 GC 取代**:blob 随最后一条引用它的消息一起消亡,不需要也不应该再有时间阈值。若将来仍要磁盘上限,可在 reaper 上追加时间维度策略,默认不做。

## 目标架构

### 1. 存储:FileManager 内部条目 + contentHash 去重

- 写入走 `FileManager.createInternalEntry({ source:'bytes', cleanupPolicy:'delete_when_unreferenced' })`,落盘 `{userData}/Data/Files/{uuid}.txt`,`contentHash`(xxh3-64)自动计算。
- 写前先 `findInternalByContentHash`(`FileManager.ts:1021`)查重:同内容跨轮次、跨 regenerate/分支兄弟只存一份 —— 这继承了今天 `vfs_<sha256>` 内容寻址的语义,只是寻址键从文件名变成 entry。
- vendored `VFSStorageAdapter`(`offloader.ts`)接口归我们所有,可演进:per-request 适配器携带本轮 `assistantMessageId`,`write` = xxh3 → find-or-create → 写 provisional ref(见 §3);filename→entry 映射内存持有,跨重启用 `name`(存 `vfs_<sha256[:16]>`)兜底查询。

### 2. message.data:结构化 persisted 部分

超过 `truncateThreshold`(默认 100k 字符)的 tool-result,持久化时 output 替换为:

```ts
{ kind: 'persisted-text', fileEntryId, head, tail, totalChars, totalLines }
```

(具体挂在 `src/shared/data/types/message.ts` 的 tool part output 变体上。)

- **渲染器**:显示 head/tail + 「展开」,展开经 DataApi files read(`data/api/handlers/files.ts`)按 entry 取全文。
- **prompt 组装**:从这些字段**确定性重建** `<persisted-output>` marker 文本(路径 = entry 物理路径)。同字段 → 同字节,前缀稳定不再依赖中间件重算。
- **中间件截断器**:跳过 persisted 部分(已裁剪);仅对本轮在飞行的新鲜大结果继续截断,写入同一 FileManager 适配器,使在飞行 marker 与落库 marker 同路径 —— turn 边界无 prefix bust。

### 3. 引用:复用 chat_message_file_ref,新增 role 'tool_output'

- `chatMessageRoles`(`src/shared/data/types/file.ts:465`)从 `['attachment']` 扩为 `['attachment','tool_output']`;`cmfr_role_check` CHECK 变更走**追加迁移**(`pnpm db:migrations:generate`)。表已注册在 `persistentFileRefTablesBySourceType`(`fileRelations.ts:189`),零引用反连接、级联、覆盖测试全部自动生效。
- `extractChatMessageFileEntryIds`(`MessageService.ts:210`)增加对 persisted 部分 `fileEntryId` 的收集;`replaceChatMessageFileRefsTx`(`MessageService.ts:237`)按部分类型选 role,delete-and-reinsert 语义不变。
- **在飞行保护(关键)**:`MessageServiceBackend.persistAssistant` 是终态一次性落库,但 assistant placeholder 行在 turn 开始就存在(`createUserMessageWithPlaceholders`)。offload 时立刻写一条 `tool_output` ref 指向 placeholder,防止长于 1h grace 的 turn 中 0-ref 条目被 reaper 收走;终态 replace 收敛到真实集合。turn 出错时 ref 随 placeholder 存续,随消息删除级联 —— 只是轻微过保留,无泄漏。

### 4. GC:全部交给现有机制

- 删消息/删话题/删分支子树 → FK 级联 ref 行(Layer 1/2)→ 条目变 0-ref → entry-cleanup reaper(30min 空闲 tick + 1h grace,`entryCleanup.ts:55`)删行删 blob;行删/文件删之间崩溃由每周 FS 孤儿清扫(`orphanSweep.ts`)兜底。
- 去重意味着共享内容由**任一存活分支**的 ref 保活;最后一个兄弟删除后自动回收。
- 不新增策略枚举、不新增 `lastUsedAt`、不新增定时器。

### 5. fs_read:从目录包含改为 per-request allow-list

blob 移入 `Data/Files` 后不能再给目录级 root(会暴露附件/画作)。context build 渲染 marker 时把本请求出现的 entry 物理路径收集进 `RequestContext`(同 `fileAttachments` 模式),`FsReadTool.allowedRoots` 换成精确路径集合校验。模型只能读**本请求 prompt 里引用过的** blob,注入猜 uuid 无效。

### 6. VfsBlobService 退役与例外

- 主聊天路径:适配器换成 FileManager 后,temp 目录、7 天 sweep、`feature.context_build.vfs.temp` 路径键、`getRoot` 皆无消费者,随改动删除(v1 residue 规则)。
- **例外 — TemporaryChatBackend**:临时聊天无 DB 消息行,provisional ref 无处挂,FileManager 条目会在 1h 后被收割而会话可能还在进行。临时聊天保留一个 temp-dir(或内存)适配器,fs_read allow-list 同样适用。此为遗留 VfsBlobService 的唯一存活场景,可缩减为纯适配器。

### 7. 旧数据兼容

- 旧 fat 行**不强制回填**:中间件继续在飞行截断它们,经同一适配器落盘并 ref 到当前 turn 的 placeholder(去重保证一份)。
- 可选后续:backfill job(`contentHashBackfillJobHandler` 先例)渐进改写旧行为 persisted 部分。注意每个旧会话首次改写会有一次性 prefix cache bust。

### 8. 前缀复用与准确率(相对现状只强不弱)

- marker 由 persisted 字段确定性渲染 → 字节稳定,不再依赖「每次重算恰好一致」。
- contentHash 去重 → regenerate/分支兄弟同 entry 同路径 → 分叉点前字节不变,provider prefix cache 跨分支存活(与今天等价)。
- 中间件顺序不变(contextBuild 先于 anthropicCache 放缓存断点)。
- blob 生命周期 == 消息生命周期 → 活会话的 fs_read **永不悬空**;这是 TTL 方案给不了的准确率保证。

## 落地顺序

1. **schema/shared**:role 枚举 + CHECK 追加迁移;persisted 部分类型 → 验证:`pnpm db:migrations:check`、schema 测试。
2. **FileManager 适配器 + provisional ref**(含 xxh3 去重、name 兜底查询)→ 单测。
3. **持久化裁剪**:finalize 前 trim + extract/replace refs → MessageService 测试(`setupTestDatabase`)。
4. **prompt 渲染 persisted 部分 + fs_read allow-list** → contextBuild/FsReadTool 测试。
5. **UI 展开 + breaking-changes 条目**(工具结果历史显示截断,需展开)。
6. (可选)backfill job。

## 实施结论(2026-08-02,feat/context-build-truncation)

三个开放决策的定案:①临时聊天/一次性 streamPrompt **不落盘**(纯内联 head/tail 截断,VfsBlobService 整体退役,仅留启动时对旧 temp 目录的一次性清理);②本期只裁新写入,旧行靠在飞行截断兼容,不回填;③放弃 30 天 TTL,纯引用式 GC。

与设计稿的主要差异/细化:

- **信封替代裸 marker 存储**:`message.data` 存结构化 `$persistedToolOutput`(`src/shared/ai/transport/persistedToolOutput.ts`:fileEntryId + vfsFilename + head/tail + counts + shape),prompt 组装时由 `renderPersistedToolOutputs`(`ai/messages/persistedOutputRendering.ts`,挂 `toModelMessages` 首步)确定性重建 marker——字节等同由契约测试钉死。
- **v1 范围收窄**:仅裁字符串输出与全文本 MCP 信封(`shape: 'text' | 'mcp-content'`);结构化 JSON 大输出仍存全量(`toModelOutput` 二次包装问题),由在飞行截断兜底,后续可加 `shape:'json'`。
- **裁剪落点**:`MessageServiceBackend.persistAssistant`(仅 SQLite 路径)在同步 finalize 事务前 await `trimOversizedToolOutputs`;refs 与 data 同事务写入。逐 part 容错,存储失败保留全量。
- **在飞行车道**:`createFileManagerStorageAdapter`(`ai/contextBuild/persistedOutputAdapter.ts`)write = 去重建 entry + **立即写 provisional `tool_output` ref** 指向 placeholder 行(1h grace 降为兜底);锚定判定 = message 行存在(临时聊天有合成 uuid 无行,只看 messageId 会 FK 违规)。
- **fs_read**:目录包含改为 per-request 精确路径 allow-list(`RequestContext.persistedOutputPaths`,历史信封 + 在飞行新增;realpath 比较,字面成员优先使 blob 失联时报 not-found)。
- **设计稿 G1 证伪**:`copyPathRowsTx` 无需补 ref 复制——唯一调用方 `TopicService.duplicate` 已按 source-id map 整体复制 ref 行(role 保真,`tool_output` 自然覆盖);在 copyPathRowsTx 内重导会撞 `(entry, source, role)` 唯一索引。
- **渲染端**:复用既有 `$deferredToolResult` 传输链,投影时附带 excerpt,取回失败降级为摘录 + 注记。

Breaking-changes 条目:`v2-refactor-temp/docs/breaking-changes/2026-08-02-tool-output-excerpt-storage.md`。
Backfill 接缝:维护任务 walk `message.data` → `trimOversizedToolOutputs` → `messageService.update`(自动重导 refs);本期未实现。
