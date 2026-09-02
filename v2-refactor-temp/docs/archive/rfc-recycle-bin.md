# RFC: Delete 进入 Recycle Bin —— 统一软删除 + Restore + 过期清理

> 状态:已实施(PR #16746 —— Delete/Restore/purge/Recycle Bin 均已落地)。
> 范围决策(已定):除 knowledge 外,所有高价值业务 domain 的 Delete 均移入 Recycle Bin(可 Restore);knowledge 维持硬删;note 暂缓(§4.5 留有设计草稿)。
> API 形状遵循 [docs/references/data/api-design-guidelines.md](../../../docs/references/data/api-design-guidelines.md),尤其其 DataApi 副作用硬规则(§5);标识符命名已按 [naming-conventions.md](../../../docs/references/architecture/naming-conventions.md) 及仓库既有格式审计(Preference 叶子段 snake_case、job type 点分命名空间、IpcApi action 段 snake_case)。

## 1. 背景

当前 v2 数据层的删除语义不一致(审计结论,2026-07-04):

- `deletedAt` 列存在于 5 张表:`agent`、`assistant`、`topic`、`message`、`file_entry`(均来自 `createUpdateDeleteTimestamps`,见 `schemas/_columnHelpers.ts:48`)。
- 其中**只有 assistant 真正软删**(`AssistantService.ts:546`);file 对内部文件实现了半套回收站(`inTrash` 过滤 + `deletedAt: null` 即恢复,`FileEntryService.ts:433-436, 599`);agent/topic/message 虽然**所有读查询都过滤 `isNull(deletedAt)`**,删除却仍是 `tx.delete()` 硬删(`AgentService.ts:426`、`TopicService.ts:369`、`MessageService.ts:1385`)。
- note、painting、agentSession 没有 `deletedAt` 列,全部硬删。
- 全库没有恢复入口、回收站 UI、过期清理 job;assistant 的软删行会无限累积。

目标:用户执行"删除"后数据进入回收站,可恢复,保留期满后由后台任务真正清除(磁盘文件一并回收)。

## 2. 范围

**纳入 Recycle Bin**(按实施优先级):

| Domain | 表 | `deletedAt` 现状 | 当前删除行为 |
|---|---|---|---|
| 话题 | `topic` | 已有,未用 | 硬删 + 级联硬删全部消息 |
| Agent | `agent` | 已有,未用 | 硬删,可选级联删 sessions |
| Agent 会话 | `agent_session` | **需新增** | 硬删,FK 级联删 session messages |
| 助手 | `assistant` | 已有,**在用** | 软删(纳入统一体系,补恢复/清理) |
| 文件(内部) | `file_entry` | 已有,半套在用 | 软删,缺 UI 和清理 |
| 绘画 | `painting` | **需新增** | 硬删,FK 级联删 file refs |

**暂缓**:note(用户决策先不做;文件本体在磁盘、需要 `.trash` 目录移动 + 忽略规则,复杂度最高。设计草稿保留在 §4.5 供后续启动)。

**不纳入**(维持硬删):`message` 单条删除与清空话题消息(见 §4.1)、knowledge(用户已决策排除)、mcpServer、provider、model、prompt、miniApp、group、tag、pin、translate 两表、skill、channel、workspace、job、appState、`agent_session_message` 单条删除(见 §4.3)。

## 3. 统一语义模型

三态生命周期,全 domain 一致:

```
active ──Delete──▶ Recycle Bin (deletedAt = now) ──保留期满 / Delete permanently──▶ purged (硬删 + 磁盘回收)
                         │
                         └──Restore──▶ active (deletedAt = null)
```

统一规则:

1. **列**:复用现有 `deletedAt`(nullable integer),不新增第二个状态时间戳 —— Recycle Bin 是唯一可恢复删除状态。
2. **读过滤**:所有 list/get 默认 `isNull(deletedAt)`;Recycle Bin 列表用 `inTrash: true` 参数(沿用 files 先例,`files.ts:86`)。
3. **Delete 只写容器行,不级联写子行**。Delete topic 只置 `topic.deletedAt`,其 messages 原样不动 —— 子行通过父行的可见性间接隐藏,Restore 因此天然无损。FK 的 `SET NULL` / `CASCADE` 只在 purge(真 DELETE)时触发,Recycle Bin 阶段引用关系完整保留。
4. **pin / tag 在 Delete 时立即 purge,Restore 不还原**。这是刻意取舍:
   - pin 必须清 —— `TopicService.ts:325-327` 明确警告:残留 pin 行会让 `listByCursor` 的 JOIN 把 topic 从两个区块里静默藏掉;
   - tag 沿用 assistant 现状(`AssistantService.ts:553`),保持行为一致。
   - 代价:恢复后需重新置顶/打标签。可接受,记入 breaking-changes。
5. **Restore = `deletedAt: null`**,通过显式 restore 端点(不暴露 `deletedAt` 为通用可写字段,防止误写任意时间戳)。
6. **purge 双轨**:自动(保留期,默认 30 天,见 §6)+ 手动(Delete permanently 单条 / 清空 Recycle Bin)。两轨走同一条 purge 代码路径。

## 4. 各 domain 具体设计

### 4.1 topic + message

- **Delete topic**:`trashManyByIdsTx` 执行 `update set deletedAt`,保留现有的 `pinService.purgeForEntitiesTx` / `tagService.purgeForEntitiesTx` 调用;messages 留在原地,purge 时才清。
- **Restore topic**:清 `deletedAt`。messages、groupId、assistantId 均未动过,无损。
- **单条消息删除 / 清空话题消息**:**维持硬删,不软删**。cascade=false 的删除会把子消息 reparent 到祖父节点(`MessageService.ts:1389-1441`),树结构已变,恢复无意义;既然不提供恢复,软删就只剩下一张永远没人读的墓碑表。回收站粒度是 topic。
- **purge topic**:DELETE topic 行 + `purgeByTopicIdsTx` 清消息(FK 级联清 `chat_message_file_ref`)→ 附件 `file_entry` 变零引用,由 #16727 的 entry cleanup 回收磁盘(解决 `TopicService.ts:329` 的 TODO,见 §6 依赖说明)。

### 4.2 agent + agent_session

- **schema**:`agent_session` 换用 `createUpdateDeleteTimestamps`;`agent_session_message` 不加列(purge session 时 FK 级联硬删,`agentSessionMessage.ts:15`)。
- **Delete agent**:active 路径写 `agent.deletedAt`;`deleteSessions` 选项通过 `trashByAgentIdTx` 连同会话一起移入 Recycle Bin(批量写 session.deletedAt)。pin 照旧 purge。
- **会话读过滤**:`AgentSessionService` 的 list/get 补 `isNull(deletedAt)`(现在没有此过滤)。
- **磁盘目录**:Delete 时一律不动,清理不挂在删除调用上(DataApi 禁止非数据副作用,见 §5),而是由 purge job 做**孤儿扫描** —— 与 file 的 orphan sweep 同一哲学:keep-set 在事务提交后从 DB 现读,删除路径不往外传任何状态;**只回收能认出归属的东西**,认不出的一律不碰(与“删掉所有认不出的”正好相反)。扫描分三段:
  - ①`feature.agents.data`(`{userData}/Data/Agents`)下 **uuid 命名**的直接子目录对应 `agent.id`,无对应行(含 Recycle Bin 行则保留)即删除。⚠️ 三个 app 自有运行时根(`.claude` / `.pi` / `.dsh`)与 `system` 都是这一层的直接子目录,靠 uuid 命名过滤排除。
  - ②`feature.agents.system_workspaces`(`Data/Agents/system`)下的 `{date}/{sessionId}` 由 `agent_workspace.path` 认领,session purge 删行后目录随之回收。
  - ③各运行时自己的 session 持久化,由 `AgentSessionRuntimeDriver.reclaimOrphanSessions` 实现,keep-set 是存活 `agent_session_message.runtimeResumeToken` 的集合(session 行被 purge 后 FK 级联带走 token,位于 Recycle Bin 期间则保留 → Restore 无损)。5 分钟 mtime 新鲜度闸门放过在写的会话。各运行时布局不同:pi 是平铺 `{ts}_{token}.jsonl`;dsh 是 `{projectKey(cwd)}/{sessionId}/session.jsonl`,**按 project 目录整体回收**(subagent 会话有自己的目录、id 不被 Cherry 记录,但与父会话共享 cwd,且日志默认 zstd 压缩读不了 header);claude 是 `{projects}/{cwd-slug}/{id}.jsonl` + `{id}/` 子目录,**只扫 Cherry 自己的 `.claude/projects`**,不能用 SDK 的 `deleteSession`(它按调用进程的 `CLAUDE_CONFIG_DIR` 解析,主进程没设 → 落到用户真实 `~/.claude`;而且登录版 provider 本来就故意把会话写进用户目录,那部分不回收)。
- **Delete session**:写 `deletedAt`;messages 不动。`agent_session_message` 的单条删除维持硬删(高频、低价值、无 Restore 场景)。
- **purge**:agent → DELETE 行(存活 session 的 `agentId` FK `SET NULL`,`agentSession.ts:11`),磁盘目录随后由孤儿目录扫描回收;session → DELETE 行(FK 级联清 messages)。

### 4.3 assistant(补齐)

- 软删已就位,本方案补:Restore 端点、Recycle Bin 列表(`inTrash`)、纳入 purge job。
- `deleteTopics=true` 语义变为“连同话题一起移入 Recycle Bin”(topics 走 4.1 的 Delete 路径,而非现在的硬删)。Restore assistant 只恢复自身行;一同移入的 topics 在 Recycle Bin 中独立 Restore(不做联动 Restore,避免状态机复杂化)。
- purge assistant → DELETE 行,topic.assistantId FK `SET NULL`(`topic.ts:22`)。

### 4.4 file(补齐)

- 内部文件 Recycle Bin 已能用(Delete/Restore/`inTrash` 过滤/统计均已实现),本方案补:Recycle Bin UI 入口 + 纳入 purge job。
- **外部文件维持现状**:`fe_external_no_delete` CHECK 约束禁止软删(`file.ts:97`),外部条目 Remove from Library 只移除索引行、不碰用户磁盘文件 —— 语义本来就无损,无需进入 Recycle Bin。
- **purge**:DELETE entry 行 → 该行退出 `listAllIds()`(`FileEntryService.ts:550`)→ 现有 orphan sweep 将 `{userData}/Data/Files/{id}.{ext}` 从磁盘 unlink。purge job 完成 DB 清理后应主动触发一次 sweep。
- 注意:files 的 DataApi 是只读的,变更走 File IPC(`files.ts:1-51` 无 delete 端点)—— file 的 restore/purge 端点加在 File IPC 侧,不破坏 DataApi 边界。

### 4.5 note(暂缓 —— 本期不实施,设计草稿留存)

note 是磁盘 markdown 为本体、DB 行仅作索引(`note.ts:6-21`,`deleteByPath` 只删行不删文件,`NoteService.ts:119-129`),纯 DB 软删不够——文件树按磁盘渲染,原文件留在原地会照常显示,且新笔记占用同路径会撞索引。方案:

- **schema**:`note` 换 `createUpdateDeleteTimestamps`,另加 `originalPath: text()`(nullable,仅 Recycle Bin 行使用)。
- **Delete**:磁盘文件移入笔记根下 `.trash/{noteId}/{basename}`;DB 行 `deletedAt = now`、`path` 更新为 trash 位置、`originalPath` 记录原路径。文件树遍历与搜索忽略 `.trash/`。
- **Restore**:文件移回 `originalPath`;若被占用,追加 ` (restored)` 后缀;清 `deletedAt` / `originalPath`。
- **purge**:unlink trash 文件 + DELETE 行。
- 文件夹递归 Delete:逐文件移入 Recycle Bin(保留各自 originalPath),Restore 可按条目单独进行。

### 4.6 painting

- **schema**:`painting` 换 `createUpdateDeleteTimestamps`。
- **Delete**:写 `deletedAt`;`painting_file_ref` 保留(没发生行删除,FK 级联不触发)→ 引用的生成图仍“有主”,磁盘图片安全。
- **Restore**:清 `deletedAt`,refs 原样,无损。
- **purge**:DELETE 行 → FK 级联清 refs → 生成图 `file_entry` 变零引用,由 #16727 的 entry cleanup 回收磁盘图片(见 §6 依赖说明)。
- list 查询补 `isNull(deletedAt)` 过滤。

## 5. API 设计(DataApi)

遵循 [api-design-guidelines.md](../../../docs/references/data/api-design-guidelines.md);沿用现有端点风格(`topics.ts` 的 CSV bulk + `:id` 单删,`assistants.ts` 的 query flag):

| 操作 | 端点 | 说明 |
|---|---|---|
| Delete | `DELETE /{resource}/:id`、`DELETE /{resource}?ids=a,b` | 现有端点,行为从硬删改为软删,**渲染层调用方零改动**。agent/agent_session 例外:其增删改走 IpcApi(`ai.agent.*`),DataApi 侧只有 `restore` 与 `inTrash` 读 |
| Delete permanently | `DELETE /{resource}/:id?permanent=true` | 仅允许 Recycle Bin 中的条目,直接硬删 DB 行(仅 DB,见下方边界说明)。**集合端点不支持 `permanent`** —— 无调用方,按需求驱动未实现 |
| Recycle Bin 列表 | `GET /{resource}?inTrash=true` | 沿用 files 的参数先例(`files.ts:86`);默认(省略)仍只返回 active |
| Restore | `POST /{resource}/:id/restore` | 新增;遵循指南 Non-CRUD “Resource actions” 模式。不暴露 deletedAt 为通用可写字段。Recycle Bin 支持逐行 Restore,**批量 Restore 无调用方,未实现** |

**副作用边界(硬规则)**:DataApi handler 只允许 SQLite 读写(guidelines §"Hard Rule: No Non-Data Side Effects")。因此:

- `permanent=true` 只做 DB 硬删;磁盘回收由后台兜底,删除端点不碰文件系统 —— 消息附件/生成图走 #16727 的 entry cleanup(见 §6),agent 目录走孤儿目录扫描。
- file 的四类操作全部走 File IPC(files 的 DataApi 只读,`files.ts:1-51` 无变更端点),不为其新开 DataApi 变更端点。
- “清空 Recycle Bin / 立即清理”是对 JobManager 的工作流命令,指南明确将 `POST /jobs`(enqueue)列为反模式 —— 走 IpcApi 路由 `trash.purge_now`(action 段 snake_case,同 `ai.generate_text`、`binary.install_tool` 先例),由业务服务调用 `application.get('JobManager')` 触发一次立即执行的 purge。

## 6. 过期清理(purge job)

> **依赖 PR #16727(file-manager GC,`eurfelux/feat/file-manager-gc`)**。本 RFC 早先假设"孤儿扫描回收附件/生成图磁盘文件"是错的:现有 file orphan sweep(`orphanSweep.ts` `scanOrphanEntries`)是 **"preserve" 策略——只报告零引用条目、从不删除**(architecture §7.1),`runFileSweep` 又只 unlink 无 DB 行的 blob。所以 purge 删掉 topic/painting 后,虽然 `*_file_ref` 级联没了、内部 `file_entry` 变成零引用,磁盘 blob 仍回收不掉。#16727 引入 `file_entry.cleanup_policy`(`manual` | `delete_when_unreferenced`)+ `FileManager.runEntryCleanup`(`internal/entryCleanup.ts`,1h grace + 安全阈值)真正回收 auto-policy 的零引用条目,并把聊天附件/AI 图/绘画输出归类为 `delete_when_unreferenced`。**本功能的磁盘回收委托给 #16727,不在本 RFC 内自行实现。** 集成后:①purge 后改调 `runSweep({ confirmed })` / `runEntryCleanup`(而非当前 report-only 的 `runSweep()`),清空回收站这类大批量 drain 需 `confirmed` 绕过安全阈值;②两分支曾同时占用同一迁移号,共享 `MessageService/PaintingService/TopicService/FileEntryService/orphanSweep.ts`,已按「regenerate, never rename」重生迁移解冲突(本分支最终追加为 `0017`)。**注意区分**:用户在文件回收站里主动删的内部文件走本 job 的 `fileEntryService.purgeExpiredTx`(删行→退出 `listAllIds()`→FS sweep unlink,今天就正确);#16727 处理的是**从未进回收站、因父数据被 purge 而变零引用**的附件/图,两者互补不重叠。

- **基建**:复用 `JobManager`(`job_schedule` + handler 注册,`schemas/job.ts:23-43`)。job type 为 `'trash.purge'`(点分命名空间格式,同 `'agent.task'` 先例;经 `jobRegistry.ts` declaration merging 注册 payload 类型),cron 每日一次(如 03:00),`catchUpPolicy` 设为错过即启动时补跑。
- **保留期**:新 Preference 键 `data.trash.retention_days`(叶子段 snake_case,同 `data.backup.local.max_backups` 先例),默认 `30`,`0` = 永不自动清理。⚠️ Preference schema 是生成物 —— 改 `v2-refactor-temp/tools/data-classify/data/` 的定义后 `npm run generate`,不得手改 `preferenceSchemas.ts`。
- **执行**:对每个 domain,`deletedAt < now - retention` 的行分批(如每批 500)在 `withWriteTx` 内硬删(同步事务,遵守 better-sqlite3 约束);**磁盘操作全部在事务提交后执行**,失败仅记日志、下轮重试 —— DB 行已删时磁盘残留是可接受的暂态,由孤儿扫描兜底。
- **顺序**:先容器后独立行 —— topic(连带 messages)→ session(连带 session messages)→ agent → assistant → painting → file entry → 最后跑磁盘回收:#16727 的 entry cleanup(回收因 purge 变零引用的内部附件/图,须 `confirmed` 以放行大批量 drain)+ agent 孤儿目录扫描(回收无对应 agent 行的目录,§4.2)。集成前 file entry 的磁盘 blob 由现有 FS sweep 处理用户主动删的内部文件。

## 7. UI(最小可用)

- **入口**:设置 → 数据 → Recycle Bin。按 domain 分组列表:话题 / Agent / 会话 / 助手 / 绘画 / 文件,每条展示名称 + 删除时间 + 剩余天数,操作:Restore、Delete permanently;顶部:清空 Recycle Bin(走 IpcApi `trash.purge_now`,§5)。
- 消息级软删不出现在回收站(§4.1)。
- 组件用 `@cherrystudio/ui`,文案全部走 i18next(`pnpm i18n:sync`)。
- 各 domain 页内嵌 Recycle Bin 入口为后续增强,不在本期。

## 8. 迁移与兼容

- schema 改动(painting/agent_session 加列)直接改 schemas + `pnpm db:migrations:generate`。migrations/ 已随 v2.0.0-rc.1 发布并跑在真实用户数据上:**只能向后追加,不得改写或重排已发布的迁移**(实际落地为 `0017_happy_jack_murdock`)。
- v1→v2 迁移器不受影响(v1 无 Recycle Bin 状态可携带)。
- 用户可感知变化(Delete 不再立即清除、置顶/标签在 Restore 后不保留、默认 30 天自动清理)→ 在 `v2-refactor-temp/docs/breaking-changes/` 记一条。

## 9. 实施阶段

| 阶段 | 内容 | 验证 |
|---|---|---|
| P1 数据层 | painting/agent_session 加列;topic/agent/session/painting 删除路径改软删;session/painting 读过滤补齐;`permanent=true` 支持 | `setupTestDatabase()` 单测:删→列表不可见→`inTrash` 可见→行仍在;pin 残留回归测试(topic JOIN) |
| P2 Restore | 各 domain restore 端点 + assistant/file 补齐 | 单测:Delete→Restore→列表可见、子数据无损 |
| P3 清理 | `trash.purge` job + `data.trash.retention_days` preference + 两类孤儿扫描串联 + IpcApi `trash.purge_now` | 单测:过期行被清、未过期保留;refs/磁盘文件随 purge 消失 |
| P4 UI | 设置页回收站 + i18n | 手动验证 + i18n check |

每阶段独立可合入;P1 合入后用户已获得"误删可救"(数据还在库里),P2/P3/P4 逐步补齐体验。note 为暂缓项(§4.5),启动时作为独立一期追加。

## 10. 已知取舍与开放问题

**已定取舍**:pin/tag 恢复不保留(§3.4);单条消息不可恢复(§4.1);外部文件不入回收站(§4.4);assistant 恢复不联动恢复 topics(§4.3)。

**开放问题**(不阻塞 P1):
1. 保留期默认 30 天是否合适?是否要在清空/彻底删除时二次确认?
2. 回收站 UI 放设置页是否足够,还是聊天侧边栏也要"最近删除"入口?
3. 是否还需要独立的“收纳”功能(类似微信/Telegram,但不代表 Delete)?本方案不含;若需要应另行设计状态,不得与 Recycle Bin 混用一列。
