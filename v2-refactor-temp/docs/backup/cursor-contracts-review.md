# Cursor against-review：契约 PR #17340

审：`resourcePlanning.ts` + `RestoreResultSummary` + `FileResource` export。对照 `MergeContext` / `BackupManifest` / `restoreJournal` / `restorePromotion` / `full-restore-plan.md` §6–§7。假设仍有错；只报真问题。

PR：`feat/backup-v2-restore-contracts` → `feat/backup-v2-restore`（纯类型，无行为变更）。

---

## Findings

### P0-1 — 冲突策略文案 vs merge 可消费面：KB/skill 无法「对齐 merge SKIP」

**Evidence**
- 契约自述（`resourcePlanning.ts:10-13, 35-36`）：*every resource class skips on conflict … matching merge's uuid-entity SKIP*
- `ResourcePlan` 喂 merge 的集合只有 `stagedFileEntryIds` / `skippedFileEntryIds`（`resourcePlanning.ts:40-42`）
- `MergeContext` 同名字段语义明确是 **file_entry** blob 集合（`merge/types.ts:152-159`）
- `MergeEngine` 仅在 `agg.root === 'file_entry'` 读 `skippedFileEntryIds`（`MergeEngine.ts:435`）；无 knowledge/skill 旁路
- `skips: SkippedResource[]` 只服务披露 UI（`resourcePlanning.ts:45-46`），不进 MergeEngine

**Failure scenario（与 A1-review P0-1 同一模式，被本 PR 冻进类型）**
本地无 `knowledge_base` / skill 行、磁盘已有同名目录 → planning 不产出 `dir-add`、只记 `skips[]` → merge 仍 INSERT 行 → journal 无对应 resource → promotion 不搬目录 → **DB 有行、目录是孤儿/缺失**。

**Fix（合入前钉死其一，并改契约）**
- 扩展 `ResourcePlan` + `MergeContext`（如 `skippedKnowledgeBaseIds` / `skippedSkillFolderNames`）并在 MergeEngine 对对应 root 强制 skip；或
- 收回「every class … matching merge SKIP」表述：明确同源 skip **仅 file_entry**；KB/skill 磁盘冲突另定 abort / 接受 dangling 并写进 e2e 预期。

---

### P1-1 — `toRestore.kind` 词表未钉死；`resources` 无法按 ResourceClass 聚合

**Evidence**
- `RestoreResultSummary.toRestore` / `toSkip`：`kind: string`（`shared/types/backup.ts:73-74`）
- `SkippedResource.kind: ResourceClass`（`'file'|'knowledge'|'skill'|'note'`，`resourcePlanning.ts:20, 28`）——`toSkip` 声称 1:1 mirror，shared 侧却放宽成 `string`
- `FileResource.kind` 是 `'blob-add'|'dir-add'|'note-add'|…`（`restoreJournal.ts:71-79`）；§7 规定 knowledge **与** skill 都是 `dir-add`
- `ResourcePlan` 无预计算的 restore 计数；也无 per-resource 的 `ResourceClass` 字段

**Failure scenario**
A2/B4 并行时：
- 若按 `FileResource.kind` 聚合 → knowledge/skill 合并成一个 `dir-add` bucket，披露 UI 分不开；
- 若按 `ResourceClass` 聚合 → 从 `resources[]` **推不出来**（`dir-add` 无 class 判别），只能靠路径前缀启发式（未进契约）或各写各的。

**Fix**
1. 把 `ResourceClass` 放到 `@shared/types/backup`（main import shared；勿让 shared 依赖 main）；
2. `toSkip.kind` / `toRestore.kind` 都用 `ResourceClass`；
3. 在 `ResourcePlan` 上增加 plan 时算好的 `toRestore`（或等价 counts），A2 原样拷进 IPC——不要事后从 `FileResource[]` 反推。

---

### P1-2 — `resources: FileResource[]` 宽于「仅 *-add」不变量

**Evidence**
- 注释：*all `*-add` kinds; no overwrite*（`resourcePlanning.ts:43-44`）
- `FileResource` = 全量 journal schema，含 `'note-overwrite'|'overwrite'`（`restoreJournal.ts:71-79`）
- §7 映射表只有 `blob-add` / `dir-add` / `note-add`

**Failure scenario**
冻结后 A1 用类型当护栏仍可 `push({ kind: 'overwrite', … })`；若再带上 `asidePath`，会绕过「本 PR 不碰 overwrite / 不改 restorePromotion」的边界，且要到 promotion/测试才爆。

**Fix**
`ResourcePlan.resources` 收窄为 add-only，例如：

```ts
type AddFileResource = Extract<FileResource, { kind: 'blob-add' | 'dir-add' | 'note-add' }>
```

journal 仍用完整 `FileResource`；planning → journal 赋值方向安全（窄 → 宽）。

---

### P2-1 — `skippedFileEntryIds` JSDoc 把 external/pruned 算进 skip

**Evidence**
- `resourcePlanning.ts:41-42`：*conflict/external/pruned*
- §8：`origin !== 'internal'` / 缺源 → **`ARCHIVE_CORRUPT` 抛错**，不是 skip（`full-restore-plan.md:112-117`）

**Fix**
JSDoc 改为仅 conflict（及契约内明确的 skip 原因）；external/缺源/错类型保持 CORRUPT，避免 A1 照注释实现成 skip。

---

## 简要核对（无 finding）

| 审点 | 结论 |
|------|------|
| `Set` → `MergeContext.ReadonlySet` | 可赋；MergeEngine 只 `.has()`，不 mutate |
| `Set` JSON / 跨进程 | `ResourcePlan` 留在 main；进 journal 的是 `resources[]`，进 IPC 的是 `RestoreResultSummary` 数组——无 Set 序列化路径 |
| `PlanCtx` 字段 vs §10.1 | 与计划骨架一致；`restoreId` 属 journal/orchestrator，planning 全 skip 无 aside 时不需要 |
| `PlanRoots.notes` | 与 `BackupService.resolveNotesRoot(): string \| undefined` 一致 |
| `BackupManifest` 资源字段 | `files.ids` / `knowledge.bases` / `skills.folders` / `notes.paths` 均存在 |
| `FileResource` export | `z.infer<typeof FileResourceSchema>` 正确 |
| `restorePromotion` 局部 `FileResource` | `RestoreJournal['fileResources'][number]` 与 export 等价；双定义无冲突，统一 import 非必须 |
| `RestoreResultSummary` 位置 / 将来时 | `shared/types/backup.ts` + 纯 type（非 zod）符合 M→R TCB 事件惯例；toRestore/toSkip 将来时语义对 |
| 命名 | `resourcePlanning.ts` camelCase 符合函数模块约定 |

---

## 总体判断

**不建议原样合入 `feat/backup-v2-restore`。**

纯类型 PR 无运行时回归，但作为「开工前冻结」它会把两处分叉锁死：

1. **P0-1**：文案承诺全 class 对齐 merge SKIP，类型却只给 file_entry 喂 merge；
2. **P1-1/P1-2**：披露 `kind` 与 `resources` 形状不足以支撑并行 A1/B4 的同一语义。

至少修 P0-1 策略面 + P1-1 kind/toRestore 派生路径后再合；P1-2 / P2-1 可同 PR 顺手收紧。
