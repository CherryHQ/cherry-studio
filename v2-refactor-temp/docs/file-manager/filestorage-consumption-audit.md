# FileStorage（v1）消费方式审计 — 取缔 vs 照搬

> ℹ️ **已知债务（决定于 2026-07-13，非阻塞）**："绝对路径"类型（`FilePath` / `AbsolutePathSchema`）尚未统一（无 branded + 运行时校验的单一表示），详见 **§7**。**决定：迁移不为此阻塞**——路径边界先用 `as FilePath` cast 凑合，类型统一作为后续清理项（改动集中、成批易清）。原为阻塞项，现下调。

> **本文档覆盖**：Group B1（`src/main/ipc.ts` 里由 v1 `FileStorage` 支撑的 **25 条 legacy channel**）的**每个生产消费者**，判定其消费方式在 v2 是 **照搬重接 / 取缔重设计 / 缠绕延后**，并给出改写草图。
>
> **这不是纯 transport 迁移**——重点是甄别哪些消费方式本身是 v1 反模式、应被新 API 设计**取缔**（而非照搬到 IpcApi）。
>
> **上游审计**：channel 注册清单与消费者 file:line 见 [`legacy-file-ipc-audit.md`](./legacy-file-ipc-audit.md) §4.1。本文档只做**判定 + 改写**，不重复消费者原始清单。
>
> **调研日期**：2026-07-04 · **分支**：`eurfelux/refactor/file-ipc`

---

## 0. 判断框架（已与需求方对齐）

| 维度 | 结论 |
| --- | --- |
| **判断基准** | [`rfc-file-manager.md`](./rfc-file-manager.md) **§7.2 File IPC（读写）** + §7.3 使用示例 = 权威目标 API。消费方式在 §7.2 **无 1:1 对应**、必须改变调用方式 → 判为「取缔」。 |
| **每消费者三种判定** | ✅ **Reroute**（照搬重接，§7.2 有等价方法，仅换调用/包 `FileHandle`，语义不变） · ⛔ **Abolish**（§7.2 故意不提供，消费者必须换做法） · ⏸ **Defer**（命运绑定 Notes→entry 系统 / §12 DirectoryTreeBuilder，本轮不深挖） |
| **产出深度** | 判定 + 改写草图；§7.2 无承接方法则点名「需新增 X」（见 §5）。 |
| **Notes 集群** | 裸外部 FS 结构操作（`mkdir`/`move*`/`rename*`/`deleteExternal*`/`write`(note 内容)/`checkFileName`/`validateNotesDirectory`）整体 **Defer**。 |

**§7.2 目标 `FileHandle` 约定**（改写草图统一用）：`FileHandle = FileEntryHandle { kind:'entry', entryId } | FilePathHandle { kind:'path', path }`。path 系消费者 reroute = 把裸路径包成 `{ kind:'path', path }`；entry 系 = `{ kind:'entry', entryId }`。

### 0.1 调用形态与目标路由现状（重要）

**新架构不经过 `window.api.file.*` / `window.api.fs.*`**——那是 legacy preload 面。v2 目标一律走 **IpcApi**（[`ipc-overview.md`](../../../docs/references/ipc/ipc-overview.md)）：

```ts
import { ipcApi } from '@renderer/ipc'
await ipcApi.request('file.<action>', input)   // route 为 dot-snake：namespace.action
```

RFC §7.2 用 camelCase 记概念方法（`getMetadata`、`createInternalEntry`），落到 IpcApi 是 dot-snake route（`file.get_metadata`、`file.create_internal_entry`）。**关键现状：当前 IpcApi 有 12 条 file 路由，单项操作大多仍缺失、只有 batch 版**（`get_metadata` 已在 C-1 补了单项，见下）——所以 Reroute/Abolish 的改写不仅是换调用，多数还要**先新增单项路由**（schema + handler + preload 无关，走统一 IpcApi 通道）。

| §7.2 概念方法 | IpcApi route | 现状 |
| --- | --- | --- |
| `open` | `file.open` | ✅ 已存在（`FileHandle`） |
| `showInFolder` | `file.show_in_folder` | ✅ 已存在（`FileHandle`） |
| `rename` | `file.rename` | ✅ 已存在（entry-only） |
| `getMetadata` | `file.get_metadata` | ✅ **已新增单项**（C-1，2026-07-13；输出 `PhysicalFileMetadata \| null`） |
| `getPhysicalPath` | `file.get_physical_path` | ⚠️ **需新增单项**（仅 `file.batch_get_physical_paths`） |
| `createInternalEntry` | `file.create_internal_entry` | ⚠️ **需新增单项**（仅 `file.batch_create_internal_entries`） |
| `select` | `file.select` | ⛔ **需新增** |
| `save` | `file.save` | ⛔ **需新增** |
| `read` | `file.read` | ⛔ **需新增** |
| `write` | `file.write` | ⛔ **需新增** |
| `ensureExternalEntry` | `file.ensure_external_entry` | ⛔ **需新增** |

> 单项 vs batch 的抉择（如 `get_metadata`/`create_internal_entry` 既可新增单项，也可让消费者复用已有 batch 版传 1 元素数组）承接上一份审计 [`legacy-file-ipc-audit.md`](./legacy-file-ipc-audit.md) §7 发现 #2，本文档改写草图默认写「单项 route」，实际是否新增单项 route 由 API 设计定。

---

## 1. 判定汇总（25 条）

| Channel（`window.api.file.*`） | v1 `FileStorage` 语义 | 判定 | 反模式 | §7.2 目标 | 生产消费者 |
| --- | --- | --- | --- | --- | --- |
| `select` | dialog → **合成 `FileMetadata[]`**（假 uuid、`count:1`） | ⛔ Abolish | **P1** | `select` → `string[]` | 7 |
| `selectFolder` | dialog → `string\|null` | ✅ Reroute | — | `select({directory})` | 8 |
| `open` | dialog + read(<2GB) → `{filePath,content,size}` | ⛔ Abolish | 组合 | `select` + `read` | 2 |
| `save` | save dialog + `writeFileSync` | ✅ Reroute | — | `save({content,...})`（改签名） | 8 |
| `saveImage` | PNG save dialog + 写 base64 | ⛔ Abolish | **P5** | `save({content:bytes,filters:[png]})` | 3 |
| `get` | **合成 `FileMetadata`**（假 uuid、`count:1`） | ⛔ Abolish | **P1** | `getMetadata(FileHandle)` | 7 |
| `readExternal` | `readFileCore`（外部 path，含文档抽取） | ✅ Reroute¹ | — | `read({kind:'path'},{text})` | 8 |
| `binaryImage` | 读 `storage/{id}` → `{data,mime}` | ⛔ Abolish | **P5** | `read({kind:'entry'},{binary})` | 1 |
| `savePastedImage` | 写 `storage/{uuid}{ext}` + 压缩 → `FileMetadata` | ⛔ Abolish | **P5** | `createInternalEntry({source:'bytes'})` | 1 |
| `createTempFile` | **仅返回临时路径串**（不建文件） | ⛔ Abolish | **P2** | `createInternalEntry({source:'bytes'})`² | 4 |
| `write` | 裸 `fs.writeFile(path,data)` | 🔀 Split | P2 / — / Defer | 见 §4.3 | 10 |
| `mkdir` | 裸 `fs.mkdir(recursive)` | ⏸ Defer | **P3** | —（Notes） | 2 |
| `move` | 裸 `fs.rename`（建父目录） | ⏸ Defer | **P3** | —（Notes） | 2 |
| `moveDir` | 裸 `fs.rename` | ⏸ Defer | **P3** | —（Notes） | 2 |
| `rename` | 裸 `fs.rename` + **硬编码 `.md`** | ⏸ Defer | **P3** | —（Notes） | 1 |
| `renameDir` | 裸 `fs.rename` | ⏸ Defer | **P3** | —（Notes） | 1 |
| `deleteExternalFile` | **`shell.trashItem`**（进回收站） | ⏸ Defer | **P3** | —（Notes）³ | 1 |
| `deleteExternalDir` | `shell.trashItem` | ⏸ Defer | **P3** | —（Notes） | 1 |
| `batchUploadMarkdown` | 批量复制 .md + 建目录结构 | ⏸ Defer | **P3** | —（Notes） | 1 |
| `checkFileName` | `checkName`+`getName` 去重 + 硬编码 `.md` | ⏸ Defer⁴ | **P3** | —（Notes） | 5 |
| `validateNotesDirectory` | notes 根目录合法性校验 | ⏸ Defer | **P3** | —（Notes） | 2 |
| `isTextFile` | chardet + isBinaryFile buffer 探针 | ⛔ Abolish | **P4** | `getMetadata().type==='text'`⁵ | 2 |
| `isDirectory` | `fs.stat().isDirectory()` | ⛔ Abolish | **P4** | `getMetadata().kind==='directory'` | 3 |
| `showInFolder` | `shell.showItemInFolder`（home 相对解析） | ✅ Reroute | — | `showInFolder(FileHandle)` | 3 |
| `openPath` | `shell.openPath`（home 相对解析） | ✅ Reroute | — | `open(FileHandle)`⁶ | 9 |

> ¹ `readExternal` 是**读**、不在 Notes-Defer（Q3 只列 mutation）；但 `readFileCore` 含文档抽取，v2 `read` 是否抽取见 §5 缺口②。
> ² temp-file 的 v2 归宿本身是开放设计点，见 §5 缺口①。
> ³ v1 是 `shell.trashItem`（回收站），§7.2 `permanentDelete` 的 path 变体是 `ops.remove`（物理删）——**语义不同**，见 §4.4。
> ⁴ `checkFileName` 的 sanitize 部分可抽为 shared 纯函数、与 Notes 解耦，见 §4.4。
> ⁵ `getMetadata` 的 buffer 探针（OTHER→TEXT）是否保留见 §5 缺口③。
> ⁶ 与顶层 `window.api.openPath`（`Open_Path`）功能重复，见 §4.2。

**判定分布**：✅ Reroute 5 · ⛔ Abolish 9 · ⏸ Defer 10 · 🔀 Split 1（`write`，跨三态）。

---

## 2. 取缔反模式详解（P1–P5）

每个反模式给「为什么取缔 + 规范改写 + 受影响消费者」。消费者 file:line 全部相对 `src/renderer/`。

### P1 — 描述符穿 DB 行皮（`select` / `get`）

**病灶**：`selectFile` / `getFile` 对一个**裸路径**现造一份 `FileMetadata`——`id: uuidv4()`（每次调用都换 id）、`count: 1`、`origin_name`。这是把「路径此刻的物理描述」硬塞进「持久化 DB 行」类型。v2 已把两个角色拆开（RFC §4.5.3）：路径描述 → `FileInfo` / `PhysicalFileMetadata`（无 id/count），身份 → `FileEntry`（走 sanctioned 生产入口）。因此**"从裸路径拿一个带 id 的文件对象"这个动作本身被取缔**。

**规范改写**（按消费者真实意图二选一）：

```ts
// 意图 A：只要物理属性（size/type/mime/kind），不需要身份
const meta = await ipcApi.request('file.get_metadata', { kind: 'path', path })   // PhysicalFileMetadata，无 id

// 意图 B：要把文件纳入系统（拿到稳定身份）→ 显式入库，不再靠 get 现造 id
const entry = await ipcApi.request('file.create_internal_entry', { source: 'path', path })  // Cherry 拷贝
// 或引用外部： ipcApi.request('file.ensure_external_entry', { externalPath: path })
```

**受影响消费者**：

- `select`（7，全部 P1）：`components/composer/tools/components/AttachmentButton.tsx:30`、`hooks/useFiles.ts:49`、`pages/code/CodeCliPage.tsx:442`、`components/resource/dialogs/import/ImportSkillDialog.tsx:80,99`、`pages/knowledge/components/AddKnowledgeItemDialog.tsx:192`、`pages/files/FilesPage.tsx:601`
  - **CodeCliPage:442**（选可执行文件路径）→ 只要 `string` 路径，改 `select({...})` 返回 path，**连 metadata 都不需要**（意图最轻）。
  - **AttachmentButton / AddKnowledgeItemDialog / FilesPage**（选文件去入库/附加）→ `select` 拿 paths，再对每个 `createInternalEntry({source:'path'})`。
  - **ImportSkillDialog:80,99**（选 zip / 目录去安装）→ 只要 path，交给 skill 安装 IPC，不需要 FileMetadata。
- `get`（7，全部 P1）：`utils/input.ts:20,47`、`components/composer/paste/pasteHandling.ts:50,83,98`、`pages/translate/TranslatePage.tsx:624,626`
  - `pasteHandling:50,83` 与 `TranslatePage:624` 是 **P2 temp-file dance 的尾巴**（`createTempFile→write→get`）——切到 `createInternalEntry({source:'bytes'})` 后 `get` **整个消失**（entry 自带身份+元数据）。
  - `input.ts:20,47`（拖入文件 → 拿 metadata 去附加）→ 意图 B：`createInternalEntry`/`ensureExternalEntry`。
  - `pasteHandling:98` / `TranslatePage:626`（粘贴的文件已有 path）→ 同上，入库或 `getMetadata`。

### P2 — Renderer 手工编排临时文件（`createTempFile` + `write` + `get`）

**病灶**：renderer 三连——`createTempFile(name)` 拿一个临时路径 → `write(path, bytes)` 落盘 → `get(path)` 取回 `FileMetadata`——把"字节变成一个有元数据的文件"这件事在 renderer 手工拼。v2 有单一入口 `createInternalEntry({source:'bytes'|'base64'})`（RFC §7.3 案例 3），一次调用完成落盘+建 entry+给元数据，临时文件纳入条目系统（temp mount）由 service 管。**手工 temp 编排被取缔。**

**规范改写**：

```ts
// v1：createTempFile → write → get（三次 IPC + renderer 编排；legacy preload）
const tmp = await window.api.file.createTempFile('pasted_text.txt')
await window.api.file.write(tmp, bytes)
const meta = await window.api.file.get(tmp)

// v2：一次调用（走 IpcApi）
const entry = await ipcApi.request('file.create_internal_entry', { source: 'bytes', data: bytes, name: 'Pasted Text', ext: 'txt' })
// 需要物理路径时： await ipcApi.request('file.get_physical_path', { id: entry.id })
```

**受影响消费者**：

- `createTempFile`（4）：`components/CodeBlockView/HtmlArtifactsCard.tsx:33`、`components/composer/paste/pasteHandling.ts:48,79`、`pages/translate/TranslatePage.tsx:620`
- `write` 中的 temp 支（4）：`HtmlArtifactsCard.tsx:34`、`pasteHandling.ts:49,82`、`TranslatePage.tsx:623`
- `get` 中的 temp 支（3，见 P1）：`pasteHandling.ts:50,83`、`TranslatePage.tsx:624`

> **例外须留意**：`HtmlArtifactsCard`（`createTempFile→write→openPath` 打开外部浏览器预览）是"产一个瞬态文件交给 OS"，不是要长期条目。切 `createInternalEntry` 会给它多余的持久身份。它的 v2 归宿取决于 temp-file story（§5 缺口①），**改写方向待定**，本轮标 Abolish-P2 但打问号。

### P4 — 类型探针（`isTextFile` / `isDirectory`）

**病灶**：独立的"这是文本吗/这是目录吗"布尔探针。v2 `getMetadata(FileHandle)` 的返回已含 `kind`（`'file'|'directory'`）与 `type`（`'text'|'image'|...`），一次 stat 全带回。**独立探针被 getMetadata 收编。**

**规范改写**：

```ts
// isDirectory(path) → const m = await ipcApi.request('file.get_metadata', {kind:'path',path}); m.kind === 'directory'
// isTextFile(path)  → const m = await ipcApi.request('file.get_metadata', {kind:'path',path}); m.type === 'text'
```

**受影响消费者**：

- `isDirectory`（4）：`components/composer/variants/AgentComposer.tsx`（workspace 警告）、`components/composer/paste/useFileDragDrop.ts`（`getDroppedPathKind`）、`components/resourceCatalog/dialogs/import/ImportSkillDialog.tsx`、`pages/agents/messages/agentMessageListAdapter.ts`（→ `ClickableFilePath`）
- `isTextFile`（2）：`utils/file.ts`（`isSupportedFile` 兜底）、`hooks/useIsTextFile.ts`
  - chardet buffer 探针已在前一 slice 保留（下沉进 `@main/utils/file/metadata` 的 `getFileType`），§5 缺口③的退化风险**已消除**。

> **✅ 已实施（C-1，2026-07-13）**：新增单项 IpcApi route `file.get_metadata`（输出 `PhysicalFileMetadata | null`，缺失/不可读→`null`，与 `batch_get_metadata` 一致；**不引入 reason 错误码**——无消费者读）。`isDirectory`(4) + `getMetadata`(4，含 `useFileSize`/`buildFileParts`) 消费者全部迁到该 route；退休 legacy `File_IsDirectory` / `File_GetMetadata`（含 preload + FileManager handler），删 `FileStorage.isDirectory`。AgentComposer 保持 v1 行为（缺失/文件均报 `inaccessible`）——完整 missing/not_directory/inaccessible 三分仍 defer，见 [`filemetadata-consumer-audit.md`](./filemetadata-consumer-audit.md) §9(10)。

> **成本-vs-分层（决定于 2026-07-13）**：`getMetadata` 为纯 kind 探针（`isDirectory`）顺带做了层 2 内容分类（`type`/`mime`，未知扩展名还会 chardet 读 8KB）。评估后认为该开销很小（ext 未命中罕见），**本轮仍折进 `getMetadata`**，不为此新建 tier-1 `file.stat`。分层观察与 Node 参照见 [`filemetadata-consumer-audit.md`](./filemetadata-consumer-audit.md) §9(10)。

### P5 — 图片/内容特化方法（`saveImage` / `savePastedImage` / `binaryImage`）

**病灶**：为图片单开的方法，v2 用通用 create/read/save 覆盖。

| v1 | 语义 | v2 规范改写（IpcApi） |
| --- | --- | --- |
| `saveImage(name, dataUrl)` | PNG save dialog + 写 base64 | `ipcApi.request('file.save', { content: bytesFromDataUrl, defaultPath: name+'.png', filters:[png] })` |
| `savePastedImage(bytes, ext)` | 写 storage + 压缩 → `FileMetadata` | `ipcApi.request('file.create_internal_entry', { source:'bytes', data, name, ext })` |
| `binaryImage(id)` | 读 storage/{id} → `{data,mime}` | `ipcApi.request('file.read', { handle:{ kind:'entry', entryId }, encoding:'binary' })` |

**受影响消费者**：

- `saveImage`（3）：`components/CodeBlockView/HtmlArtifactsPopup.tsx:151`、`components/chat/messages/hooks/useMessageExportActions.ts:45`（`saveImage` 包装 → `messageMenuBarActions.tsx:238`）、`services/ExportService.ts:1090` — 都是"存一张图到用户选的路径"，折进通用 `save`。renderer 需先把 dataURL 解码为 bytes（`save` content 收 `string|Uint8Array`）。
- `savePastedImage`（1）：`components/RichEditor/useRichEditor.ts:402` — 富文本粘贴图 → `createInternalEntry({source:'bytes'})`。
- `binaryImage`（1）：`pages/paintings/model/canonicalGenerate.ts:170` — 读入库图片字节做图生图。该处消费者持有的是 v2 `FileEntryId` → `read({kind:'entry'}, {binary})`。

### `open`（dialog + read）— 组合取缔

**病灶**：`open` 一次做「弹框选文件 + 读内容(<2GB)」两件事。§7.2 无此组合方法（handler-mapping 已定：拆为 `select` + `read`，renderer 自行组装）。

```ts
// v1： const { content } = await window.api.file.open({ filters })   // legacy preload
// v2（走 IpcApi，拆 select + read）：
const picked = await ipcApi.request('file.select', { filters })       // string | string[] | null
const p = Array.isArray(picked) ? picked[0] : picked
if (p) {
  const { content } = await ipcApi.request('file.read', { handle: { kind:'path', path: p }, encoding:'text' })
}
```

**受影响消费者**（2）：`components/Popups/ImportPopup.tsx:46`（读 ChatGPT 会话 JSON）、`services/BackupService.ts:130`（读备份文件）。

---

## 3. 照搬重接（Reroute）— 仅换调用/签名

这些消费方式在 §7.2 有直接等价，语义不变，迁移只改调用形态。

| Channel | 目标 route（现状） | 改写要点 | 消费者 |
| --- | --- | --- | --- |
| `selectFolder` | `file.select`（`{directory:true}`）⛔需新增 | `ipcApi.request('file.select', {directory:true})`，返回仍是 `string\|null`，几乎零改 | `utils/exportExcel.ts:80`、`components/resource/WorkspaceSelector.tsx:120`、`hooks/useCodeCli.ts:150`、`pages/settings/DataSettings/MarkdownExportSettings.tsx:41`、`pages/notes/NotesSettings.tsx:40`、`pages/knowledge/components/AddKnowledgeItemDialog.tsx:211`、`services/BackupService.ts:105,115` |
| `save` | `file.save` ⛔需新增 | `ipcApi.request('file.save', { content, defaultPath?, filters? })`；v1 `save(fileName, content, options)` 三参 → v2 单对象；语义同（save dialog + 写） | `components/ImageViewer.tsx:129`、`components/CodeBlockView/view.tsx:181`、`components/CodeBlockView/HtmlArtifactsCard.tsx:45`、`components/chat/messages/hooks/useMessageExportActions.ts:41`、`hooks/resourceCatalog/useResourceCatalogController.ts:162`、`services/ExportService.ts:319,365,1040` |
| `readExternal` | `file.read` ⛔需新增 | `ipcApi.request('file.read', { handle:{kind:'path',path}, encoding:'text', detectEncoding? })`；⚠️ 文档抽取语义见 §5 缺口② | `components/Popups/SaveToKnowledgePopup.tsx:319`、`hooks/useNotesQuery.ts:67`、`pages/translate/TranslatePage.tsx:478`、`pages/notes/hooks/useNotesMenu.tsx:104`、`pages/notes/hooks/useNotesEditing.ts:48`、`pages/knowledge/components/AddKnowledgeItemDialog.tsx:110`、`services/ExportService.ts:1101`、`services/NotesSearchService.ts:93` |
| `showInFolder` | `file.show_in_folder` ✅已存在 | `ipcApi.request('file.show_in_folder', {kind:'path',path})` | `components/chat/panes/OpenExternalAppButton.tsx:94`、`pages/home/messages/homeMessageListAdapter.tsx:343`、`pages/agents/messages/agentMessageListAdapter.ts:150` |
| `openPath` | `file.open` ✅已存在 | `ipcApi.request('file.open', {kind:'path',path})`；与 `Open_Path` 合一见 §4.2 | `components/CodeBlockView/HtmlArtifactsCard.tsx:35`、`components/chat/panes/OpenExternalAppButton.tsx:84,103`、`components/chat/citations/CitationsPanel.tsx:16`、`hooks/useAttachment.ts:25`、`pages/home/messages/homeMessageListAdapter.tsx:339`、`pages/agents/messages/agentMessageListAdapter.ts:143`、`pages/agents/components/Sessions.tsx:978`、`pages/knowledge/hooks/usePreviewKnowledgeSource.ts:47` |
| `write`（导出支） | `file.write` ⛔需新增 | `ipcApi.request('file.write', { handle:{kind:'path',path}, data })`，写用户选定的导出路径，语义不变 | `utils/exportExcel.ts:92`、`services/ExportService.ts:334,383` |

> **`readExternal` 与 Notes 的关系**：8 个消费者里 6 个读的是 Notes 外部文件（`useNotesQuery`/`useNotesMenu`/`useNotesEditing`/`AddKnowledgeItemDialog`/`ExportService`/`NotesSearchService`）。但**读**可以独立于 Notes→entry 模型迁移先行 reroute 到 `ipcApi.request('file.read', {handle:{kind:'path'}})`——不必等 Notes 变 entry。故归 Reroute，不归 Defer。

---

## 4. Defer 桶（Notes 集群）

Notes 的结构性操作把「外部文件树」当模型直接裸操作 `fs`，其 v2 形态取决于两个尚未拍板的决策：(a) Notes 是否纳入 `FileEntry` 条目系统；(b) 是否走 §12 `DirectoryTreeBuilder`。因此本轮**不给改写草图**，只登记缠绕点。

### 4.1 Defer 清单

| Channel | 消费者 | 缠绕原因 |
| --- | --- | --- |
| `mkdir` | `services/NotesService.ts:95,394` | 建笔记子目录——若 Notes 变 entry 则为 `createInternalEntry({type:'dir'})` 类操作 |
| `move` / `moveDir` | `pages/notes/NotesPage.tsx:493,496,880,882` | 拖拽移动 + 失败回滚；entry 化后为 `move(entryId, newParent)` |
| `rename` | `services/NotesService.ts:203` | 裸 rename + **硬编码 `.md`**；entry 化后 rename 不该在 renderer 拼扩展名 |
| `renameDir` | `services/NotesService.ts:207` | 同上（目录无 ext） |
| `deleteExternalFile` / `deleteExternalDir` | `services/NotesService.ts:187,189` | 见 §4.4 语义警告 |
| `batchUploadMarkdown` | `services/NotesService.ts:250` | 批量导入 .md + 重建目录结构；entry 化后为 `batchCreateEntries` |
| `checkFileName` | `pages/notes/NotesPage.tsx:864`、`services/NotesService.ts:93,106,196,301` | 命名去重 + 冲突检测，Notes 树语义 |
| `validateNotesDirectory` | `services/NotesService.ts:155`、`pages/notes/NotesSettings.tsx:63` | notes 根目录选择校验 |
| `write`（note 内容支） | `pages/notes/NotesPage.tsx:168`、`services/NotesService.ts:108,305` | 写笔记内容 |

### 4.2 顺带发现：`openPath` 双 channel 重复

`window.api.file.openPath`（`File_OpenPath`→`FileStorage.openPath`）与顶层 `window.api.openPath`（`Open_Path`→内联 `shell.openPath`）**功能重复**（都是"系统默认程序打开路径"，都做 home 相对解析）。§7.2 只有一个 `open(FileHandle)`。迁移时应**合一**——顶层 `Open_Path` 的 5 个消费者（见 [`legacy-file-ipc-audit.md`](./legacy-file-ipc-audit.md) §4.4）一并收敛到 `open(FileHandle)`。

### 4.3 `write` 的三态拆分（汇总）

`write` 是 B1 唯一跨三态的 channel，10 个消费者按真实模式分流：

| 支 | 判定 | 消费者 |
| --- | --- | --- |
| 导出到选定路径 | ✅ Reroute（§3） | `exportExcel.ts:92`、`ExportService.ts:334,383` |
| temp-file dance | ⛔ Abolish P2（§2） | `HtmlArtifactsCard.tsx:34`、`pasteHandling.ts:49,82`、`TranslatePage.tsx:623` |
| Notes 内容 | ⏸ Defer（§4.1） | `NotesPage.tsx:168`、`NotesService.ts:108,305` |

### 4.4 Defer 桶内的两个独立可动项

即便 Notes 整体 Defer，以下两点与 entry 模型解耦、可单独推进：

1. **`checkFileName` 的 sanitize**：`checkName(fileName)` 是纯字符串消毒，可抽为 `@shared` 纯函数（renderer 直接调，零 IPC），与 Notes 树冲突检测解耦。handler-mapping 早已如此定调。
2. **`deleteExternal*` 语义警告**：v1 是 `shell.trashItem`（进系统回收站，可恢复）。§7.2 `permanentDelete` 的 path 变体走 `ops.remove`（**物理删除，不可恢复**）。若 Notes 迁移时直接映射到 `permanentDelete(FilePathHandle)` 会**悄悄把"进回收站"改成"物理删"**——这是行为回退，迁移时必须显式决策（保留 trash 语义则 §7.2 需补一个 `trashItem` 能力，见 §5 缺口④）。

---

## 5. §7.2 缺口 / 需新增 API

按框架（Q2），指出 §7.2 尚无承接、需补的能力：

| # | 缺口 | 触发消费者 | 建议 |
| --- | --- | --- | --- |
| ① | **temp-file 归宿**：`createTempFile` + write-to-temp 的"产瞬态文件交给 OS"场景（HTML 预览打开外部浏览器）。切 `createInternalEntry` 会强加持久身份。 | `HtmlArtifactsCard.tsx:33,34,35` | 定：(a) temp mount 下的 entry + `getPhysicalPath`，还是 (b) 保留一个轻量 `writeTemp(bytes)→path` 工具。**§7.2 目前两者都无。** |
| ② | **`read` 是否做文档抽取**：v1 `readExternal`→`readFileCore` 对 doc/pdf/xlsx 做文本抽取。§7.2 `read` 标注只读 text/base64/binary。 | `TranslatePage.tsx:478`（读文档做翻译输入）等 | 明确 §7.2 `read(text)` 是否抽取。若否，抽取消费者需接独立抽取 IPC（cf. `Pdf_ExtractText` 保持独立）。 |
| ③ | **`getMetadata` 是否保留 buffer 探针**：v1 `isTextFile` 用 chardet 把无 ext 规则的文件判文本。 | `utils/file.ts:93`、`hooks/useIsTextFile.ts:44` | 确认 §7.2 `getMetadata.type` 冷路径做 buffer 探针（migration-plan §2.5 已如此计划）；否则这两处退化为纯 ext 派生。 |
| ④ | **`trashItem`（回收站）能力缺失**：§7.2 只有物理删 `permanentDelete`，无"进系统回收站"。 | `deleteExternalFile/Dir`（Notes） | Notes 迁移前决定：保留 trash 语义则 §7.2 需补 `trashItem(FilePathHandle)`；否则显式接受行为变更。 |

---

## 6. 小结

- **消费方式最简（低风险）**：✅ Reroute 5 条 + `write` 导出支——消费者做法不变，只换成 `ipcApi.request('file.X', ...)`。但**多数目标单项 route 尚不存在**（§0.1）：`openPath`/`showInFolder` 复用现成 `file.open`/`file.show_in_folder`，`select`/`save`/`read`/`write` 需先新增单项 route。
- **需消费者重设计（中风险）**：⛔ Abolish 9 条（P1 假 metadata、P2 temp-dance、P4 类型探针、P5 图片特化 + `open` 组合）——不是换 transport，是**改消费者做法**。改写草图见 §2。这些是"消费方式被新 API 取缔"的主体。多数还依赖新增 `file.get_metadata` / `file.create_internal_entry` / `file.read` 单项 route（§0.1）。
- **Defer（Notes）**：10 条 + `write` 内容支——命运绑定 Notes→entry 系统决策，本轮不动；但 sanitize 抽纯函数、`deleteExternal*` 的 trash 语义可先决策（§4.4）。
- **需求方待决**：§0.1 路由现状（哪些单项 route 值得新增 vs 复用 batch）+ §5 四个语义缺口（temp-file 归宿①、read 抽取②、getMetadata 探针③、trashItem④）——不定这些，改写无法定稿。

**建议推进顺序**：补齐单项 IpcApi 路由（§0.1，schema+handler；路径入参/出参先用 `as FilePath` cast，见 §7）→ Reroute 批（§3）→ P1/P4 Abolish（改写机械，依赖 `file.get_metadata`）→ 决策 §5 缺口 → P2/P5 Abolish（依赖缺口①）→ Notes 专项（Defer 桶，独立 PR）。绝对路径类型统一（§7）作为后续清理项，**不阻塞上述任何一步**。

---

## 7. 已知债务：绝对路径类型未统一（后续清理，非阻塞）

> **状态：已知债务，非阻塞（决定于 2026-07-13）**。原为阻塞项，现决定**不为此暂停迁移**——路径边界先用 `as FilePath` cast，类型统一作为后续清理项。保留本节分析作为清理依据。

### 7.1 现象

§7.2 里 `select` / `save` 返回**裸 `string`**（`string[] | null` / `string | null`），而同样产出绝对路径的 `getPhysicalPath` 返回 `FilePath`，`FilePathHandle.path` / `FileInfo.path` 也是 `FilePath`。在"路径产出面"里 `select`/`save` 是唯二例外。

**直接后果**：v2 标准工作流"选路径 → 当 `FilePathHandle` 用"（`select` → `read({kind:'path', path})`）**两端接不上类型**——`select` 给 `string`，`FilePathHandle.path` 要 `FilePath`，中间必须 `as FilePath`。选出的路径喂不进自己的 handle。

### 7.2 根因：两套"绝对路径"表示未打通

| 表示 | 定义 | 问题 |
| --- | --- | --- |
| `FilePath`（`src/shared/types/file/common.ts:38`） | 模板字面量 `` `/${string}` \| `${string}:\\${string}` `` | **纯类型级 hint、无 brand、无运行时身份**（注释自述 "Runtime validation required — the template-literal pattern only provides type-level hints"） |
| `AbsolutePathSchema`（`src/shared/data/types/file/fileEntry.ts:143`） | `z.string().min(1).refine(...)` | `.refine` 不改输出类型 → **`z.infer` 出裸 `string`，不是 `FilePath`** |

`FilePathHandleSchema.path`（`handle.ts:55`）用 `AbsolutePathSchema` 校验（输出 `string`），但 TS 类型 `FilePathHandle.path` 是 `FilePath`——靠 `as` 桥接。代码自己挂了 TODO 招供（`src/shared/types/file/handle.ts:59-60`）：

```ts
// TODO: 1. Wire schema and types, so no as cast needed
// TODO: 2. Add brand for FileHandle since factory function has been used
```

即：`select`/`save` 只是**症状**；病根是 `FilePath`（类型侧、无 brand）与 `AbsolutePathSchema`（校验侧、infer 出 `string`）是两个东西，全 API 靠 `as` 缝合。补 `FilePath` 到 select/save 只会多加 cast，治标不治本。

### 7.3 代价与决定（原阻塞理由）

本文档改写全部围绕 `FilePathHandle` / `read` / `write` 的路径入参与 `select`/`save`/`getPhysicalPath` 的路径出参。在类型未统一前落地的代价：

- 每处 `select→handle`、`get_metadata({kind:'path'})`、`write({kind:'path'})` 要补 `as FilePath`；
- 现有 3 处 `as`-cast 会扩散到几十个消费者；
- §0.1 待新增单项 route 的 schema 路径类型沿用现状（`AbsolutePathSchema` 输出 `string` + 类型侧 `as FilePath`）。

**决定（2026-07-13）**：接受上述代价，**不为此阻塞迁移**——`as FilePath` cast 改动集中、后续统一时可成批清理。

### 7.4 修复方向（重构目标）

统一为**一个"运行时已校验 + 编译期 branded"的绝对路径类型**：

- 让 `AbsolutePathSchema` 的输出就是 branded `FilePath`（`.refine(...).transform((s) => s as FilePath)`，或 `z.brand`），使校验与 brand 合一；
- 所有路径面同源：`select`/`save` 返回 `FilePath | null` / `FilePath[] | null`；`getPhysicalPath` / `FilePathHandle.path` / `FileInfo.path` / `read`·`write` 入参统一用之；
- brand 是编译期的，过 IPC 仍是普通 string，校验在 IPC 边界由同一 schema 完成——闭环；
- 顺带消化 `handle.ts:59-60` 两个 TODO（no `as` cast + FileHandle brand）。

**清理完成后**：picked path → `FilePathHandle` **零 cast**，迁移期铺开的 `as FilePath` 成批移除。

### 7.5 影响面（重构预计触及）

- `src/shared/types/file/common.ts`（`FilePath` 定义）
- `src/shared/data/types/file/fileEntry.ts`（`AbsolutePathSchema`）
- `src/shared/types/file/handle.ts`（`FilePathHandle` + `FilePathHandleSchema` + 两个 TODO）
- `src/shared/types/file/info.ts`（`FileInfo.path`）
- `src/shared/ipc/schemas/file.ts`（现有 `batch_get_physical_paths` 等 `AbsolutePathSchema.nullable()` 出参）+ §0.1 未来单项 route
- `FileManager.getPhysicalPath` 等返回 `FilePath` 的实现处

> 具体重构方案（`z.brand` vs phantom-brand `transform`；是否顺带统一 `Base64String`/`UrlString`/`UrlString` 等 sibling 类型）**另开设计**，不在本审计范围。
