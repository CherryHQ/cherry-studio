# Knowledge Item 操作流程说明

本文档记录当前分支中 v2 knowledge item 在添加 / 嵌入、删除、重嵌入、restore 时的实际流程。这里描述的是当前代码行为，不是未来目标。

相关入口：

- `src/main/services/knowledge/KnowledgeOrchestrationService.ts`
- `src/main/services/knowledge/runtime/KnowledgeRuntimeService.ts`
- `src/main/data/services/KnowledgeItemService.ts`
- `src/main/services/knowledge/runtime/utils/prepare.ts`
- `src/main/services/knowledge/readers/KnowledgeReader.ts`

## 1. 基本模型

### 1.1 item 类型

当前持久化的 `knowledge_item.type` 有五类：

1. `file`
2. `url`
3. `note`
4. `directory`
5. `sitemap`

其中：

- `file` / `url` / `note` 是 leaf item，也是当前真正会被读取、切块、嵌入、写入向量库的 item。
- `directory` / `sitemap` 是 container item。它们本身不直接写入向量库，而是在 runtime preparation 阶段展开成 child leaf item。
- `directory` 展开后可以生成 nested `directory` child，用来保留文件系统目录层级；最终可索引的叶子仍然是 `file`。
- `sitemap` 展开后生成 `url` child。

### 1.2 数据字段

当前各类型的核心 `data` 语义：

- `file`
  - `source`: 展示和 chunk metadata 中的来源文本。
  - `fileEntryId`: FileManager 管理的文件引用，是读取文件的真实句柄。
- `url`
  - `source`: 展示和 chunk metadata 中的来源文本。
  - `url`: 抓取网页内容时使用的 URL。
- `note`
  - `source`: 展示和 chunk metadata 中的来源文本。
  - `content`: 直接参与嵌入的正文。
  - `sourceUrl`: 可选来源 URL，不参与当前 runtime 读取。
- `directory`
  - `source`: 展示用来源文本。
  - `path`: 扫描目录时使用的根路径。
- `sitemap`
  - `source`: 展示用来源文本。
  - `url`: 抓取 sitemap XML 时使用的 URL。

### 1.3 状态字段

`knowledge_item.status` 当前取值：

- `idle`
- `processing`
- `completed`
- `failed`

`knowledge_item.phase` 当前取值：

- `null`
- `preparing`
- `reading`
- `embedding`

leaf item 的典型状态流：

```text
idle
 -> processing, phase = null
 -> processing, phase = reading
 -> processing, phase = embedding
 -> completed, phase = null
```

container item 的典型状态流：

```text
idle
 -> processing, phase = preparing
 -> processing, phase = null
 -> completed / failed, phase = null
```

container 的最终 `completed` / `failed` 由 `KnowledgeItemService.reconcileContainers()` 根据 child 状态聚合：

- 如果 container 自己仍有 `phase`，保持 `processing`。
- 如果还有 child 未进入 `completed` 或 `failed`，保持 `processing`。
- 如果任意 child 是 `failed`，container 变为 `failed`，错误为 `One or more child items failed`。
- 如果所有 child 都完成且没有失败，container 变为 `completed`。
- 如果 container 没有 child 且 `phase = null`，也会被聚合为 `completed`；但 directory / sitemap 展开为空时，prepare 阶段会先显式写成 `failed`。

## 2. 添加与嵌入

添加入口是 `KnowledgeOrchestrationService.addItems(baseId, items)`。调用方传入 runtime payload，不直接通过 DataApi 创建 `knowledge_item`。

通用流程：

```text
caller
 -> KnowledgeOrchestrationService.addItems()
 -> assertBaseCanRunRuntimeOperation()
 -> normalizeRuntimeAddItems()
 -> KnowledgeRuntimeService.addItems()
 -> KnowledgeItemService.create()
 -> updateStatus(processing / preparing)
 -> enqueue prepare-root 或 index-leaf
```

### 2.1 file 添加

当前 runtime add 的 file 输入仍然是路径型：

```text
data: {
  source,
  path
}
```

orchestration 会先执行 `normalizeKnowledgeFileData()`：

1. 检查扩展名是否属于 knowledge 支持的文本 / 文档类型。
2. 调用 `FileManager.ensureExternalEntry({ externalPath: path })` 创建或复用 external file entry。
3. 把 runtime 输入转换成持久化形态：

```text
data: {
  source,
  fileEntryId
}
```

之后 runtime 创建 `knowledge_item`：

1. `KnowledgeItemService.create()` 插入 `knowledge_item`。
2. 因为类型是 `file`，同时写入 `file_ref`：
   - `fileEntryId`
   - `sourceType = knowledge_item`
   - `sourceId = item.id`
   - `role = source`
3. runtime 把 item 更新为 `processing`。
4. 入队 `index-leaf`。

`index-leaf` 执行时：

1. 状态写为 `processing, phase = reading`。
2. `KnowledgeFileReader.loadFileDocuments()` 通过 `item.data.fileEntryId` 调 FileManager：
   - `fileManager.getById(fileEntryId)`
   - `toFileInfo(entry)`
   - 根据 ext 选择 PDF / CSV / DOCX / EPUB / JSON / Markdown / Text reader。
3. reader 从 FileManager 解析出的物理路径读取文件。
4. 读取出的 document 会统一带上 metadata：

```text
source = item.data.source
```

5. 按 base 的 `chunkSize` / `chunkOverlap` 切块。
6. 状态写为 `processing, phase = embedding`。
7. 调用 embedding model。
8. 写入当前 base 的 vector store。
9. 状态写为 `completed, phase = null`。

如果文件已不存在，当前读取会在 FileManager / `toFileInfo()` / reader 阶段失败。普通 add 的失败会触发 runtime failure cleanup：

- 尝试删除该 item 已写入的向量。
- 把该 item 写成 `failed`，错误为实际异常信息。
- 如果该 item 属于 directory container，container 状态会被向上聚合。

### 2.2 url 添加

url 添加不经过 FileManager。

流程：

1. `KnowledgeRuntimeService.addItems()` 创建 `url` item。
2. 状态写为 `processing`。
3. 入队 `index-leaf`。
4. `index-leaf` 的 reading 阶段调用 `KnowledgeUrlReader.loadUrlDocuments()`。
5. URL reader 通过 `fetchKnowledgeWebPage(item.data.url)` 抓取内容：
   - 先 sanitize URL。
   - 使用 Jina Reader endpoint 把网页转换成 markdown。
   - 当前有全局抓取队列限制并发和速率。
6. markdown 为空或抓取失败会让 item 失败。
7. 成功后进入切块、embedding、vector store 写入。

chunk metadata 中的 `source` 使用 `item.data.source`。

### 2.3 note 添加

note 添加不读外部资源。

流程：

1. `KnowledgeRuntimeService.addItems()` 创建 `note` item。
2. 状态写为 `processing`。
3. 入队 `index-leaf`。
4. `KnowledgeNoteReader.loadNoteDocuments()` 直接把 `item.data.content` 包成一个 document。
5. 之后进入切块、embedding、vector store 写入。

如果 `content` 为空，reader 仍会返回 document，但切块后没有可索引内容时会触发 `KNOWLEDGE_EMPTY_CONTENT`，item 被标记为 `failed`。

### 2.4 directory 添加

directory 是 container，不直接嵌入。

添加流程：

1. `KnowledgeRuntimeService.addItems()` 创建 root `directory` item。
2. root 状态写为 `processing, phase = preparing`。
3. 入队 `prepare-root`。
4. `prepare-root` 调用 `expandDirectoryOwnerToTree()`：
   - 用 `directory.data.path` 扫描目录。
   - 忽略以 `.` 开头的文件和目录。
   - 递归扫描子目录。
   - 只保留 knowledge 支持扩展名的文件。
   - 对每个支持的文件调用 `FileManager.ensureExternalEntry()`。
5. 展开结果为空时：
   - root directory 写为 `failed`。
   - 错误为 `Directory contains no indexable files`。
   - 不创建 child。
6. 展开结果非空时：
   - 为子目录创建 child `directory` item，`groupId = parentDirectory.id`。
   - 为文件创建 child `file` item，`groupId = parentDirectory.id`。
   - child file 创建时同样写入 `file_ref`。
   - 每个 child 创建后会写成 `processing`；child directory 创建时先是 `processing, phase = preparing`，递归子项创建完成后写成 `processing, phase = null`。
7. 所有 leaf file child 会入队 `index-leaf`。
8. root directory 自身最后写成 `processing, phase = null`。
9. 后续由 child file 的完成 / 失败推动 container 状态聚合。

directory root 当前保留 `path`，它不是 FileManager file entry。directory 展开出来的 file leaf 才是 FileManager-backed file item。

### 2.5 sitemap 添加

sitemap 是 container，不直接嵌入。

添加流程：

1. `KnowledgeRuntimeService.addItems()` 创建 root `sitemap` item。
2. root 状态写为 `processing, phase = preparing`。
3. 入队 `prepare-root`。
4. `prepare-root` 调用 `expandSitemapOwnerToCreateItems()`：
   - sanitize `sitemap.data.url`。
   - fetch sitemap XML。
   - 解析 `urlset.url.loc`。
   - 去重并 sanitize 每个页面 URL。
5. 展开结果为空时：
   - root sitemap 写为 `failed`。
   - 错误为 `Sitemap contains no indexable URLs`。
   - 不创建 child。
6. 展开结果非空时：
   - 为每个页面 URL 创建 child `url` item，`groupId = sitemap.id`。
   - 每个 child url 写成 `processing`。
   - 每个 child url 入队 `index-leaf`。
7. root sitemap 自身最后写成 `processing, phase = null`。
8. 后续由 child url 的完成 / 失败推动 container 状态聚合。

## 3. 删除

删除入口是 `KnowledgeOrchestrationService.deleteItems(baseId, itemIds)`。

orchestration 会先把传入 ids 归一化为 top-level roots：

- 先读取每个 id 对应的 item。
- 校验它们属于同一个 base。
- 如果同一批里同时选中了 parent 和 descendant，只保留 parent。

通用删除流程：

```text
caller
 -> KnowledgeOrchestrationService.deleteItems()
 -> getTopLevelItemsInBase()
 -> KnowledgeRuntimeService.deleteItems()
 -> interrupt roots and descendants
 -> delete vectors for leaf descendants
 -> KnowledgeItemService.delete(root.id)
```

### 3.1 leaf 删除

直接删除 `file` / `url` / `note` root 时：

1. runtime interrupt 该 item 当前 pending / running 的 queue task。
2. 等待正在运行的任务退出。
3. 查询该 root 下的 leaf descendants。对 leaf root 来说，结果包含它自己。
4. 删除这些 leaf item 在 vector store 中的向量。
5. runtime 返回。
6. orchestration 调 `KnowledgeItemService.delete(item.id)` 删除 SQLite row。
7. 如果是 `file` item，`KnowledgeItemService.delete()` 会清理它的 `file_ref`。
8. 不删除 external source file，也不删除 FileManager file entry。

如果向量删除失败：

- runtime 会把被中断范围内的 item 标记为 `failed`。
- 删除操作抛错。
- orchestration 不会继续删除 SQLite root row。

### 3.2 directory 删除

删除 directory root 时：

1. runtime 先 interrupt root。
2. 查询 descendants，再 interrupt root + descendants。
3. 查询 root subtree 中所有可索引 leaf descendants，也就是其中的 `file` / `url` / `note`。
4. 删除这些 leaf item 的向量。
5. runtime 返回。
6. orchestration 删除 directory root row。
7. SQLite 外键级联会删除 `groupId` 指向该 root / nested directory 的 child rows。
8. `KnowledgeItemService.delete()` 会先收集 descendants，并清理 root + descendants 的 `file_ref`。
9. external source files 和 FileManager file entries 不会被删除。

### 3.3 sitemap 删除

sitemap 删除与 directory 类似：

1. interrupt root + descendants。
2. 删除 child url leaf 的向量。
3. 删除 sitemap root row。
4. 级联删除 child url rows。

sitemap 没有 FileManager file refs。

## 4. 重嵌入

重嵌入口是 `KnowledgeOrchestrationService.reindexItems(baseId, itemIds)`。

通用入口行为：

1. 拒绝在 `failed` base 上执行，提示先 restore。
2. 读取传入 ids。
3. 校验 item 属于目标 base。
4. 将传入 ids 归一化为 top-level roots。
5. 对直接选中的 file roots 做 missing 预检。
6. 把剩余 roots 交给 runtime reindex。

### 4.1 直接 file root 重嵌入

当前新增的特殊处理是：如果用户直接选中的是 `file` root，orchestration 会先调用：

```text
FileManager.getDanglingState({ id: item.data.fileEntryId })
```

行为：

- 返回 `missing`：该 file item 直接写成 `failed`，错误为 `Source file is missing`，不会调用 runtime reindex，旧 chunks / vectors 保留。
- 返回 `present`：进入 runtime reindex。
- 返回 `unknown`：当前不当作 missing，进入 runtime reindex，由后续 FileManager / reader 读取决定成败。

如果同一批重嵌入里有多个 root，只过滤掉 missing file root，其它 root 继续执行。

进入 runtime 后，leaf reindex 流程是：

1. interrupt root 和 descendants。
2. 查 leaf descendants。对 leaf file root 来说包含它自己。
3. 删除旧向量。
4. 把该 file item 写成 `processing`。
5. 入队 `index-leaf`。
6. 重新读取 FileManager physical path、切块、embedding、写向量。
7. 成功后写成 `completed`。

如果 runtime 阶段失败，例如文件在预检后又被删除：

- runtime 会清理该 item 向量。
- item 写成 `failed`。
- 这时旧向量通常已经在 reindex 前被删除。

### 4.2 url root 重嵌入

url 没有预检。

流程：

1. interrupt root。
2. 删除旧向量。
3. item 写成 `processing`。
4. 入队 `index-leaf`。
5. 重新 fetch Jina Reader markdown。
6. 重新切块、embedding、写向量。
7. 成功后写成 `completed`。

如果 fetch 失败或返回空内容，item 写成 `failed`。旧向量已经在 reindex 前删除。

### 4.3 note root 重嵌入

note 没有外部资源预检。

流程：

1. interrupt root。
2. 删除旧向量。
3. item 写成 `processing`。
4. 入队 `index-leaf`。
5. 重新读取 `item.data.content`。
6. 重新切块、embedding、写向量。
7. 成功后写成 `completed`。

如果内容无法产生 chunk，item 写成 `failed`。旧向量已经在 reindex 前删除。

### 4.4 directory root 重嵌入

directory reindex 是重建式，不是增量同步。

流程：

1. orchestration 不预检 directory descendants 的 file dangling 状态。
2. runtime interrupt root + descendants。
3. 查询旧 leaf descendants，并删除它们的旧向量。
4. 删除 container root 下的所有旧 leaf descendants：
   - 实现上调用 `KnowledgeItemService.deleteLeafDescendantItems(base.id, [directory.id])`。
   - root directory row 保留。
   - child rows 被删除。
   - 相关 `file_ref` 被清理。
5. root directory 写为 `processing, phase = preparing`。
6. 入队 `prepare-root`。
7. 重新扫描当前目录路径。
8. 重新创建 child directory / file rows。
9. 新 child file rows 重新进入 `index-leaf`。
10. root directory 根据新 child 状态重新聚合。

因此：

- 旧目录下已经不存在的 child item 会消失。
- 新出现的支持文件会被创建成新的 child file item。
- child file 的 id 会变化，因为它们被重新创建。
- 如果目录当前为空或没有支持文件，root directory 会变成 `failed`。
- 缺失的 child file 不会被单独保留为 failed，因为 directory reindex 的语义是按当前目录重新展开。

### 4.5 sitemap root 重嵌入

sitemap reindex 也是重建式。

流程：

1. runtime interrupt root + descendants。
2. 删除旧 child url leaf 的向量。
3. 删除 root 下旧 child rows。
4. root sitemap 写为 `processing, phase = preparing`。
5. 入队 `prepare-root`。
6. 重新抓取 sitemap XML。
7. 重新创建 child url rows。
8. 新 child url rows 进入 `index-leaf`。
9. root sitemap 根据新 child 状态重新聚合。

因此：

- sitemap 中移除的 URL 对应 child item 会消失。
- 新增 URL 会生成新的 child url item。
- child url 的 id 会变化。
- sitemap 抓取失败或展开为空时，root sitemap 会失败。

### 4.6 同一批多个 root

当前 reindex 接受多个顶层入口。

批量行为：

- 传入 parent + descendant 时，descendant 会被 top-level normalization 去掉，只处理 parent。
- 对直接选中的 file roots，missing 的部分先写成 failed，并从本次 runtime reindex 中移除。
- 剩下的 roots 作为同一次 runtime reindex 请求继续处理。
- 如果过滤后没有任何 root，orchestration 直接返回，不调用 runtime。
- runtime 内部如果遇到严格清理失败，例如旧向量删除失败，会抛错，并把本次 interrupt 范围内的 item 写成 failed。

## 5. Restore / Rebuild Base

restore 入口是 `KnowledgeOrchestrationService.restoreBase(dto)`。

它不是原地修复当前 base，而是新建一个 restored base，并把 source base 的 root items 重新 add 到新 base。

### 5.1 restore 前置规则

restore 先读取 source base：

- 如果 source base 是 `failed`，允许 restore，即使 embedding model 和 dimensions 不变。
- 如果 source base 不是 `failed`，只有 embedding model 或 dimensions 发生变化时才允许 restore。
- 如果 source base 已完成且 embedding config 完全不变，会拒绝 restore，避免无意义 rebuild。

### 5.2 新 base 创建

restore 会从 source base 拷贝大部分配置：

- `groupId`
- `emoji`
- `rerankModelId`
- `fileProcessorId`
- `chunkSize`
- `chunkOverlap`
- `threshold`
- `documentCount`
- `searchMode`
- `hybridAlpha`

同时使用 restore dto 中的新值：

- `name`
- `dimensions`
- `embeddingModelId`

随后：

1. `KnowledgeBaseService.create()` 创建新的 SQLite base row。
2. `KnowledgeRuntimeService.createBase()` 创建对应 vector store。

### 5.3 root items 拷贝

restore 只读取 source base 的 root items：

```text
KnowledgeItemService.getItemsByBaseId(sourceBase.id, { groupId: null })
```

也就是说：

- source base 中的 child items 不会直接拷贝。
- directory / sitemap 的 children 会在新 base 中通过 runtime preparation 重新展开。
- file / url / note root 会作为 root payload 重新 add。

restore 会把 source root item 转成 create payload：

- `file`: 使用已有持久化 `data.source` 和 `data.fileEntryId`。
- `url`: 使用已有 `data.source` 和 `data.url`。
- `note`: 使用已有 `data.source`、`data.content`、可选 `sourceUrl`。
- `directory`: 使用已有 `data.source` 和 `data.path`。
- `sitemap`: 使用已有 `data.source` 和 `data.url`。

注意：restore file root 时不会重新 `ensureExternalEntry()`，也不会先 `getById()` 检查 FileManager。它复用原 item 的 `fileEntryId`，后续由新 base 的 indexing 读取流程决定成功或失败。

### 5.4 restore 后的 indexing

restore 调用 `KnowledgeRuntimeService.addItems(newBase.id, rootPayloads)`，所以新 base 的后续行为与普通 add 一致：

- file / url / note root 直接入队 `index-leaf`。
- directory / sitemap root 入队 `prepare-root`，重新展开 children。
- 新创建的 file item 会在 `KnowledgeItemService.create()` 中创建新的 `file_ref`，source file entry 仍然可以是同一个 `fileEntryId`。
- 新 base 的向量会用 restore dto 指定的 embedding model / dimensions 重新生成。

### 5.5 restore 失败清理

restore 的失败处理：

- 如果 root payload 转换失败，会聚合为 `KnowledgeRuntimeAddItemsPartialError`。
- 如果 runtime addItems 接受失败，也会包装为 partial error。
- 一旦 restore 失败，orchestration 会尝试删除刚创建的新 base：
  - `deleteBase(restoredBase.id)`
  - runtime cleanup
  - SQLite base delete
  - vector artifacts delete
- source base 不会被删除。

如果删除 restored base 的 cleanup 也失败，restore 仍抛出原始 restore error，并记录 cleanup error。

## 6. 查看 chunks 与删除单个 chunk

虽然这不是嵌入 / 删除 / 重嵌入 / restore 的主流程，但它影响这些操作后的可见结果。

### 6.1 查看 chunks

入口是 `KnowledgeRuntimeService.listItemChunks(baseId, itemId)`。

流程：

1. orchestration 校验 base 不是 failed，并校验 item 属于 base。
2. runtime 查询该 item 的 leaf descendants。
3. 对每个 leaf item 调 vector store：

```text
vectorStore.listByExternalId(item.id)
```

因此：

- 查看 chunks 依赖 `knowledge_item.id` 与 vector external id 对齐。
- 查看 chunks 不直接依赖 file item 的 `fileEntryId`。
- 对 directory / sitemap 查看 chunks 时，会汇总其 leaf descendants 的 chunks。

### 6.2 删除单个 chunk

入口是 `KnowledgeRuntimeService.deleteItemChunk(baseId, itemId, chunkId)`。

流程：

1. orchestration 校验 base 不是 failed，并校验 item 属于 base。
2. runtime 获取 vector store。
3. 调用：

```text
vectorStore.deleteByIdAndExternalId(chunkId, itemId)
```

这里不会改 `knowledge_item.status`，也不会删除 SQLite item。

## 7. v1 migration 与 legacy file item

v1 migration 的 file item 处理与 runtime add 不完全相同。

mapping 阶段先保留 legacy path：

```text
data: {
  source: file.path,
  path: file.path
}
```

execute 阶段会调用 `ensureMigratedExternalFileEntryId()`：

1. canonicalize legacy path。
2. 按 lower-case external path 查找已有 external file entry。
3. 找到则复用。
4. 找不到则直接插入新的 `origin = external` file entry。
5. 不执行 `fs.stat`，不要求 legacy 文件现在仍存在。

最终写入的 v2 item data 是：

```text
data: {
  source,
  fileEntryId
}
```

同时 migration 会创建对应 `file_ref`：

```text
fileEntryId
sourceType = knowledge_item
sourceId = item.id
role = source
```

这个设计的含义：

- v2 file item 始终保持 FileManager-backed 数据模型。
- legacy path 不可访问时，仍可以创建 dangling external file entry。
- 旧 chunks / vectors 仍可迁移和展示，因为查看 chunks 不依赖 `fileEntryId`。
- 后续 reindex / 读取 / 未来 FileManager-backed 预览会通过 `fileEntryId` 观察到 dangling 状态。

## 8. 类型行为速查

| 类型 | 添加时是否直接嵌入 | 添加时是否创建 child | 删除时删除哪些向量 | 重嵌入语义 | restore 语义 |
| --- | --- | --- | --- | --- | --- |
| `file` | 是 | 否 | 自己的向量 | 直接 root 缺失时只 failed 并保留旧向量；否则删旧向量后重读 FileManager 文件 | 复用原 `fileEntryId` 重新 add / index |
| `url` | 是 | 否 | 自己的向量 | 删旧向量后重新抓取 URL | 复制 root payload 后重新抓取 |
| `note` | 是 | 否 | 自己的向量 | 删旧向量后重新读取 content | 复制 root payload 后重新嵌入 |
| `directory` | 否 | 是，生成 nested directory / file | subtree 中所有 leaf 向量 | 删除旧 children 后按当前目录重新展开 | 只复制 root，children 在新 base 重新展开 |
| `sitemap` | 否 | 是，生成 url | subtree 中所有 leaf 向量 | 删除旧 children 后重新抓取 sitemap 并展开 | 只复制 root，children 在新 base 重新展开 |
