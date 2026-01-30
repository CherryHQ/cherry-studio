# CherryStudio V2 备份系统重构规划

**版本**: v2.0-draft
**日期**: 2025-01-21
**目的**: PR Draft - 与 V2 负责人讨论备份系统重构方向

---

## 一、背景分析

### 1.1 现有架构

- **数据库**: SQLite + Drizzle ORM
- **消息结构**: 使用 `parentId` 邻接表实现树结构，支持 `siblingsGroupId` 多模型响应分组
- **内容存储**: `message.data.blocks` JSON 字段，包含 MainTextBlock、ThinkingBlock 等多种块类型

### 1.2 待解决问题

| 问题 | 优先级 |
|------|--------|
| JSON.stringify 超过 512MB 触发 V8 限制 | 高 |
| 只能全量备份，无增量支持 | 高 |
| 无法按数据域选择性备份 | 高 |
| 不支持对话合并 | 中 |

### 1.3 GitHub Issue 需求

| Issue | 需求 | 优先级 |
|-------|------|--------|
| #10844 | 细粒度备份控制、增量备份、多设备同步 | 高 |
| #12108 | 可选择的备份设置（供应商/对话/设置分离） | 高 |
| #12072 | 大文件备份失败（>512MB JSON解析限制） | 高 |
| #12110 | 全局记忆未纳入备份范围 | 中 |
| #7488 | WebDAV多端自动同步最新状态 | 低 |
| #11621 | 批量导出到第三方连接 & 云备份 | 中 |

---

## 二、架构设计

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│  packages/shared/backup/                                    │
│  ├── types.ts        # BackupManifest、BackupDomain         │
│  ├── options.ts      # BackupOptions、RestoreOptions        │
│  ├── tree.ts         # MessageTreeRef                       │
│  └── compat.ts       # 版本兼容性                           │
├─────────────────────────────────────────────────────────────┤
│  src/main/services/backup/                                  │
│  ├── orchestrator/                                          │
│  │   ├── BackupOrchestrator.ts    # 编排导出/导入流程       │
│  │   ├── StreamSerializer.ts      # 流式序列化              │
│  │   └── VersionMigrator.ts       # 版本迁移                │
│  ├── exporters/                                            │
│  │   ├── TopicExporter.ts         # 对话数据               │
│  │   ├── PreferenceExporter.ts    # 配置                   │
│  │   ├── ProviderExporter.ts      # 供应商                 │
│  │   ├── AssistantExporter.ts     # 助手                   │
│  │   ├── KnowledgeExporter.ts     # 知识库                 │
│  │   └── MemoryExporter.ts        # 记忆                   │
│  └── importers/                                            │
│      ├── BaseImporter.ts                                    │
│      ├── TopicImporter.ts         # 对话数据               │
│      └── ...                                               │
├─────────────────────────────────────────────────────────────┤
│  src/main/services/BackupManager.ts                         │
│  (简化为纯文件 I/O，保留压缩/解压/云存储能力)                │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

**备份流程**:
```
UI → BackupOrchestrator → 各 Exporter → StreamSerializer → BackupManager → ZIP/云存储
```

**恢复流程**:
```
ZIP/云存储 → BackupManager → StreamParser → VersionMigrator → BackupOrchestrator → 各 Importer → SQLite
```

---

## 三、核心数据结构

### 3.1 数据域枚举

```typescript
enum BackupDomain {
  PROVIDERS = 'providers',       // 供应商配置
  ASSISTANTS = 'assistants',     // 助手配置
  TOPICS = 'topics',             // 话题和消息
  KNOWLEDGE = 'knowledge',       // 知识库
  PREFERENCES = 'preferences',   // 应用设置
  MEMORY = 'memory',             // 全局记忆
  FILES = 'files'                // 附件文件
}
```

### 3.2 备份元数据

```typescript
interface BackupManifest {
  version: number             // 备份格式版本 (6)
  appVersion: string          // 如 "2.0.0"
  schemaVersion: string

  createdAt: string           // ISO 8601 UTC
  deviceId: string
  hostname: string
  platform: 'darwin' | 'win32' | 'linux'

  domains: BackupDomain[]
  isIncremental: boolean
  baseBackupId?: string

  stats: Record<BackupDomain, { count: number; bytesUncompressed: number }>
  checksum: string            // SHA-256
  fileChecksums: Record<string, string>

  encryption?: {
    algorithm: 'AES-256-GCM'
    kdf: 'PBKDF2'
    salt: string
  }
}
```

### 3.3 消息树引用结构

用于保持导入时的树结构完整性和冲突检测：

```typescript
interface MessageTreeRef {
  messageId: string
  topicId: string
  parentId: string | null
  siblingsGroupId: number
  originalCreatedAt: string
  contentHash: string          // data.blocks 的 SHA-256
}
```

### 3.4 备份选项

```typescript
interface BackupOptions {
  domains: BackupDomain[]
  isIncremental?: boolean
  flattenBranches?: boolean     // 将分支合并为线性对话
  excludeImages?: boolean       // 排除图片附件
  includeDataFolder?: boolean   // 包含 Data 目录
  encrypt?: boolean             // 是否加密
  password?: string             // 加密密码
}

interface RestoreOptions {
  domains?: BackupDomain[]      // 默认为全部
  conflictStrategy?: ConflictStrategy
  mergeStrategy?: MergeStrategy
  idMapping?: Map<string, string>
}
```

---

## 四、导出数据格式设计

### 4.1 推荐方案：ZIP + JSONL 混合格式

**选择理由**:
- JSONL 支持流式读写，突破 512MB 内存限制
- 每行一个 JSON 对象，便于增量恢复
- ZIP 归档保持单文件便携性

### 4.2 库选型

| 功能 | 推荐库 | 理由 |
|------|--------|------|
| **ZIP 生成** | `archiver` | 流式写入、背压处理、ZIP64 支持、zlib 级别可调 |
| **ZIP 读取** | `yauzl` | 随机访问、不加载全文件、CRC32 校验严格、损坏容错 |
| **备选读取** | `unzipper` | 流式解析、适合顺序处理、autodrain 跳过损坏条目 |
| **JSONL 读取** | `readline` (原生) | 无额外依赖、逐行处理、crlfDelay: Infinity |
| **校验和** | `xxhash-wasm` | 10x 快于 SHA-256、适合非加密完整性检查 |

**注意事项**:
- macOS Archive Utility 不支持 ZIP64，超 4GB 单文件需提示用户使用第三方工具
- `yauzl` 使用后必须调用 `zipfile.close()` 避免 Windows 文件锁定
- 压缩级别推荐 `zlib: { level: 6 }`（速度与压缩率折中）

### 4.3 ZIP 包结构

```
cherry-studio-backup-v6.zip
├── manifest.json              # 备份元数据
├── checksums.json             # 各文件 xxHash 校验和
├── providers/
│   └── data.jsonl
├── assistants/
│   └── data.jsonl
├── topics/
│   ├── index.jsonl            # Topic 元数据
│   ├── tree_refs.jsonl        # 消息树结构引用
│   └── messages/
│       ├── chunk_0000.jsonl   # 消息分片 (~50MB/片)
│       └── chunk_0001.jsonl
├── knowledge/
│   └── bases.jsonl
├── preferences/
│   └── data.json
├── memory/
│   └── data.jsonl
└── files/
    ├── manifest.json          # 文件索引 (id → hash 映射)
    └── blobs/                 # 按 hash 去重存储
        └── {hash}.bin
```

**重要：Base64 图片分离存储**

消息中的 Base64 图片**必须**从 JSONL 中分离：
- 单行 JSON 超过 50MB 会导致解析崩溃
- 导出时：提取 `data.blocks` 中的 Base64 → 写入 `files/blobs/{hash}.bin` → JSONL 中存 `{ "image_ref": "hash" }`
- 导入时：读取 `image_ref` → 从 `files/blobs/` 还原

### 4.4 流式序列化策略

**数据库分批读取 (Generator 模式)**:

```typescript
const MESSAGE_CHUNK_SIZE = 50 * 1024 * 1024  // 50MB/chunk
const MESSAGE_BATCH_SIZE = 1000              // 每批读取 1000 条

async function* streamMessages(db, topicIds) {
  for (const topicId of topicIds) {
    let offset = 0
    while (true) {
      const batch = await db.select().from(messageTable)
        .where(eq(messageTable.topicId, topicId))
        .orderBy(messageTable.createdAt)
        .limit(MESSAGE_BATCH_SIZE)
        .offset(offset).all()

      if (batch.length === 0) break
      for (const msg of batch) yield msg
      offset += MESSAGE_BATCH_SIZE
    }
  }
}
```

**JSONL 流式写入 (背压处理)**:

```typescript
import { Transform } from 'stream'

// Transform 流：对象 -> JSONL 字符串
const jsonlStringifier = new Transform({
  writableObjectMode: true,
  transform(chunk, encoding, callback) {
    try {
      this.push(JSON.stringify(chunk) + '\n')
      callback()
    } catch (err) {
      callback(err as Error)
    }
  }
})

// 写入时处理背压
async function writeJsonl(stream: Writable, data: AsyncIterable<unknown>) {
  for await (const record of data) {
    const line = JSON.stringify(record) + '\n'
    if (!stream.write(line)) {
      // 背压：等待缓冲区清空
      await new Promise(resolve => stream.once('drain', resolve))
    }
  }
}
```

**ZIP 流式生成 (archiver)**:

```typescript
import archiver from 'archiver'
import fs from 'fs'

async function createBackupZip(outputPath: string) {
  const tempPath = outputPath + '.tmp'
  const output = fs.createWriteStream(tempPath)
  const archive = archiver('zip', {
    zlib: { level: 6 },      // 速度与压缩率折中
    forceZip64: false        // 自动判断是否需要 ZIP64
  })

  archive.on('warning', (err) => {
    if (err.code !== 'ENOENT') throw err
  })
  archive.on('error', (err) => { throw err })
  archive.pipe(output)

  // 添加流式数据
  archive.append(getJsonlStream(), { name: 'topics/messages/chunk_0000.jsonl' })
  archive.append(JSON.stringify(manifest), { name: 'manifest.json' })

  await archive.finalize()

  // 原子替换：完成后重命名
  fs.renameSync(tempPath, outputPath)
}
```

### 4.5 内存监控

```typescript
// 周期性监控内存使用
function monitorMemory(thresholdMB = 500) {
  const used = process.memoryUsage().heapUsed / 1024 / 1024
  if (used > thresholdMB) {
    console.warn(`Memory usage: ${used.toFixed(2)} MB, consider reducing batch size`)
  }
  return used
}

// 动态调整批量大小
function adaptiveBatchSize(currentSize: number, memoryUsedMB: number): number {
  if (memoryUsedMB > 400) return Math.max(100, currentSize / 2)
  if (memoryUsedMB < 200) return Math.min(5000, currentSize * 1.5)
  return currentSize
}
```

---

## 五、导入解析机制

### 5.1 版本兼容性

- **最低可读版本**: V5
- **当前写入版本**: V6
- **迁移路径**: V5 → V6 (localStorage/indexedDB → 分域 JSONL)

### 5.2 流式解压读取

**使用 yauzl 按需读取**:

```typescript
import yauzl from 'yauzl'

function readManifestOnly(zipPath: string): Promise<BackupManifest> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err)

      zipfile.readEntry()

      zipfile.on('entry', (entry) => {
        if (entry.fileName === 'manifest.json') {
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) return reject(err)
            let json = ''
            readStream.on('data', chunk => json += chunk)
            readStream.on('end', () => {
              zipfile.close()  // 重要：释放文件句柄
              resolve(JSON.parse(json))
            })
          })
        } else {
          zipfile.readEntry()  // 跳过，继续下一个
        }
      })

      zipfile.on('end', () => reject(new Error('Manifest not found')))
    })
  })
}
```

**使用 unzipper 流式解压**:

```typescript
import unzipper from 'unzipper'
import fs from 'fs'
import readline from 'readline'

async function* streamJsonlFromZip(zipPath: string, entryPath: string) {
  const directory = await unzipper.Open.file(zipPath)
  const entry = directory.files.find(f => f.path === entryPath)

  if (!entry) throw new Error(`Entry not found: ${entryPath}`)

  const stream = entry.stream()
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  })

  for await (const line of rl) {
    try {
      yield JSON.parse(line)
    } catch (e) {
      console.warn('JSON 解析错误，跳过行:', line.slice(0, 100))
    }
  }
}
```

### 5.3 ID 冲突解决策略

```typescript
enum ConflictStrategy {
  SKIP = 'skip',          // 跳过冲突项
  OVERWRITE = 'overwrite', // 覆盖现有
  RENAME = 'rename',       // 生成新 ID
  MERGE = 'merge'          // 智能合并 (仅 topics)
}
```

**ID 映射**: 使用 `Map<oldId, newId>` 跟踪重命名，更新所有引用（parentId、topicId 等）

**引用更新流程**:
1. 第一遍：扫描所有记录，检测 ID 冲突，建立映射表
2. 第二遍：读取数据时，使用映射表更新所有引用字段

### 5.4 数据验证流程

```typescript
interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
  manifest?: BackupManifest
}

async function validateBackup(zipPath: string): Promise<ValidationResult> {
  const errors: ValidationError[] = []
  const warnings: string[] = []

  // 1. 验证 manifest.json 存在且版本兼容
  const manifest = await readManifestOnly(zipPath)
  if (!manifest) {
    errors.push({ code: 'MISSING_MANIFEST', message: 'manifest.json not found' })
    return { valid: false, errors, warnings }
  }

  if (manifest.version > CURRENT_BACKUP_VERSION) {
    errors.push({
      code: 'VERSION_TOO_NEW',
      message: `Backup version ${manifest.version} > supported ${CURRENT_BACKUP_VERSION}`
    })
  }

  // 2. 校验各文件 xxHash
  const checksums = await readJsonFromZip(zipPath, 'checksums.json')
  for (const [filePath, expectedHash] of Object.entries(checksums)) {
    const actualHash = await computeXxHashFromZip(zipPath, filePath)
    if (actualHash !== expectedHash) {
      errors.push({
        code: 'CHECKSUM_MISMATCH',
        message: `Checksum mismatch for ${filePath}`
      })
    }
  }

  // 3. 验证 topic-message 引用完整性
  // ...

  return { valid: errors.length === 0, errors, warnings, manifest }
}
```

### 5.5 事务性恢复

```typescript
async function importBackup(zipPath: string, options: RestoreOptions) {
  const validation = await validateBackup(zipPath)
  if (!validation.valid) {
    return { success: false, errors: validation.errors }
  }

  try {
    // 创建还原点
    await db.run(sql`SAVEPOINT backup_import`)

    // 按依赖顺序导入
    const importOrder = [
      BackupDomain.PREFERENCES,
      BackupDomain.PROVIDERS,
      BackupDomain.ASSISTANTS,
      BackupDomain.KNOWLEDGE,
      BackupDomain.MEMORY,
      BackupDomain.TOPICS,  // 依赖 assistants
      BackupDomain.FILES
    ]

    for (const domain of importOrder) {
      if (validation.manifest!.domains.includes(domain)) {
        await importDomain(zipPath, domain, options)
      }
    }

    // 提交
    await db.run(sql`RELEASE SAVEPOINT backup_import`)
    return { success: true }

  } catch (error) {
    // 回滚
    await db.run(sql`ROLLBACK TO SAVEPOINT backup_import`)
    return { success: false, errors: [{ code: 'IMPORT_FAILED', message: error.message }] }
  }
}
```

---

## 六、跨平台可靠性

### 6.1 路径处理

- ZIP 内部始终使用 `/` 分隔符
- 导入时转换为本地分隔符
- 文件名净化：移除 `<>:"/\|?*` 及控制字符
- Windows 路径长度限制 260 字符，ZIP 内路径尽量扁平化

### 6.2 编码一致性

- 所有文本文件使用 UTF-8 无 BOM
- archiver/yazl 默认使用 UTF-8 编码文件名（设置 bit 11 标志）
- 时间戳统一使用 ISO 8601 UTC 格式
- 非 ASCII 字符不转义

**时间戳注意事项**:
- ZIP 内部使用 MS-DOS 时间戳格式，精度为 2 秒
- 不同平台产生的 ZIP 内部文件修改时间可能有 ±1 秒舍入差异
- 建议将精确时间存储在 manifest.json 中

### 6.3 文件附件处理

- 按内容 xxHash 去重存储
- 文件清单记录原始 ID → hash 映射
- 支持大文件流式写入

```typescript
interface FileExportEntry {
  id: string              // 原文件 ID
  hash: string            // xxHash 内容哈希
  originalName: string    // 原始文件名
  mimeType: string
  size: number
  relativePath: string    // ZIP 内相对路径: files/blobs/{hash}.bin
}
```

### 6.4 原子写入策略

```typescript
// 先写临时文件，完成后原子重命名
async function atomicWrite(finalPath: string, writeFunc: (tempPath: string) => Promise<void>) {
  const tempPath = finalPath + '.tmp'
  try {
    await writeFunc(tempPath)
    fs.renameSync(tempPath, finalPath)  // 原子操作
  } catch (error) {
    // 清理临时文件
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    throw error
  }
}
```

---

## 七、增量备份方案

### 7.1 变更检测策略

**推荐方案：应用层时间戳 + 软删除**

```typescript
interface IncrementalChanges {
  created: string[]       // 新增记录 ID
  updated: string[]       // 修改记录 ID
  deleted: string[]       // 删除记录 ID
  lastChangeTime: string  // 最新变更时间
}

async function detectChanges(
  domain: BackupDomain,
  lastBackupTime: string
): Promise<IncrementalChanges> {
  const table = getTableForDomain(domain)
  const cutoffTime = new Date(lastBackupTime).getTime()

  // 新增和修改
  const changedRecords = await db
    .select({ id: table.id, createdAt: table.createdAt, updatedAt: table.updatedAt })
    .from(table)
    .where(or(
      gt(table.createdAt, cutoffTime),
      gt(table.updatedAt, cutoffTime)
    ))
    .all()

  const created = changedRecords.filter(r => r.createdAt > cutoffTime).map(r => r.id)
  const updated = changedRecords.filter(r => r.createdAt <= cutoffTime).map(r => r.id)

  // 已删除 (通过 deletedAt 软删除字段)
  const deleted = await db
    .select({ id: table.id })
    .from(table)
    .where(and(
      isNotNull(table.deletedAt),
      gt(table.deletedAt, cutoffTime)
    ))
    .all()
    .then(rows => rows.map(r => r.id))

  return { created, updated, deleted, lastChangeTime: new Date().toISOString() }
}
```

**备选方案：SQLite 触发器**

参考 [sqlite-history](https://simonwillison.net/2023/Apr/15/sqlite-history/)，使用触发器记录变更：

```sql
CREATE TRIGGER track_message_changes AFTER UPDATE ON message
BEGIN
  INSERT INTO message_history (id, version, timestamp, change_type)
  VALUES (OLD.id, OLD.version + 1, CURRENT_TIMESTAMP, 'UPDATE');
END;
```

### 7.2 增量包结构

```
cherry-studio-incremental-v6.zip
├── manifest.json              # isIncremental: true, baseBackupId: "xxx"
├── changes/
│   ├── providers/
│   │   ├── created.jsonl
│   │   ├── updated.jsonl
│   │   └── deleted.json       # ID 列表
│   ├── topics/
│   │   ├── created.jsonl
│   │   ├── updated.jsonl
│   │   ├── deleted.json
│   │   └── messages/
│   │       ├── created.jsonl
│   │       ├── updated.jsonl
│   │       └── deleted.json
│   └── ...
└── checksums.json
```

**增量清单扩展**:

```typescript
interface IncrementalManifest extends BackupManifest {
  isIncremental: true
  baseBackupId: string          // 基准全量备份 ID
  baseBackupTime: string        // 基准备份时间
  changesSummary: {
    [K in BackupDomain]?: {
      created: number
      updated: number
      deleted: number
    }
  }
}
```

### 7.3 增量恢复流程

```typescript
async function restoreIncremental(zipPath: string) {
  const manifest = await readManifestOnly(zipPath) as IncrementalManifest

  // 1. 验证基准备份已恢复
  const baseRestored = await checkBaseBackupRestored(manifest.baseBackupId)
  if (!baseRestored) {
    throw new Error(`Base backup ${manifest.baseBackupId} must be restored first`)
  }

  await db.transaction(async (tx) => {
    for (const domain of manifest.domains) {
      const basePath = `changes/${domain}`

      // 1. 删除
      const deletedIds = await readJsonFromZip(zipPath, `${basePath}/deleted.json`)
      if (deletedIds.length > 0) {
        await tx.delete(getTableForDomain(domain))
          .where(inArray(getTableForDomain(domain).id, deletedIds))
      }

      // 2. 插入新增
      for await (const record of streamJsonlFromZip(zipPath, `${basePath}/created.jsonl`)) {
        await tx.insert(getTableForDomain(domain)).values(record)
      }

      // 3. 更新修改
      for await (const record of streamJsonlFromZip(zipPath, `${basePath}/updated.jsonl`)) {
        await tx.update(getTableForDomain(domain))
          .set(record)
          .where(eq(getTableForDomain(domain).id, record.id))
      }
    }
  })
}
```

### 7.4 备份链管理

```typescript
const MAX_CHAIN_LENGTH = 7  // 最大增量链长度

class BackupChainManager {
  async shouldCreateFullBackup(): Promise<boolean> {
    const chain = await this.getBackupChain()
    return chain.length >= MAX_CHAIN_LENGTH
  }

  async getBackupChain(): Promise<BackupInfo[]> {
    // 从最新增量回溯到全量备份
    const chain: BackupInfo[] = []
    let current = await this.getLatestBackup()

    while (current) {
      chain.push(current)
      if (!current.isIncremental) break
      current = await this.getBackupById(current.baseBackupId!)
    }

    return chain.reverse()  // 按时间正序
  }

  // 压缩备份链：合并多个增量为新的全量
  async compactChain(): Promise<string> {
    const chain = await this.getBackupChain()

    // 创建临时数据库，顺序应用整个链
    const tempDb = await this.createTempDatabase()
    for (const backup of chain) {
      await this.applyBackup(tempDb, backup.path)
    }

    // 从临时数据库导出全量备份
    const newFullBackup = await this.exportFullBackup(tempDb)

    // 清理旧备份
    await this.cleanupOldBackups(chain.map(b => b.id), newFullBackup.id)

    return newFullBackup.id
  }
}
```

---

## 八、对话合并策略

### 8.1 冲突类型

```typescript
enum TopicConflictType {
  NO_CONFLICT = 'no_conflict',
  ID_CONFLICT = 'id_conflict',           // 相同 ID 不同内容
  CONTENT_DIVERGED = 'content_diverged', // 消息树分叉
  METADATA_DIFF = 'metadata_diff'        // 仅元数据不同
}
```

### 8.2 合并策略

```typescript
enum MergeStrategy {
  LOCAL_FIRST = 'local_first',           // 本地优先
  REMOTE_FIRST = 'remote_first',         // 远程优先
  TIMESTAMP_FIRST = 'timestamp_first',   // 保留最新
  USER_CHOICE = 'user_choice',           // 手动选择
  MERGE_BRANCHES = 'merge_branches'      // 合并为分支
}
```

### 8.3 树结构合并（MERGE_BRANCHES 策略）

当检测到分叉（相同 parentId 的不同子消息）：

1. 保留所有本地消息
2. 远程分叉消息分配新 `siblingsGroupId`
3. 更新 parentId 指向分叉点
4. 非分叉的远程独有消息直接添加

### 8.4 合并预览

导入前生成预览：
- 列出所有操作（create/update/merge/skip）
- 展示待决策冲突
- 统计影响范围

---

## 九、加密方案（可选）

### 9.1 推荐方案：压缩后加密

**策略**: 先用 archiver 生成普通 ZIP，再使用 Node.js crypto 模块对整个文件进行 AES-256-GCM 加密。

**理由**:
- 压缩后加密安全性更高，压缩率更好
- ZIP 原生加密（PKZIP/AES）在 Node.js 生态支持较少
- 兼容性更好，解密后可用任何工具打开

```typescript
import crypto from 'crypto'
import fs from 'fs'
import { pipeline } from 'stream/promises'

async function encryptBackup(zipPath: string, password: string) {
  // 1. 密钥派生
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(password, salt, 32, {
    N: 2 ** 14,  // CPU/内存成本
    r: 8,
    p: 1
  })

  // 2. 加密
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  const input = fs.createReadStream(zipPath)
  const output = fs.createWriteStream(zipPath + '.enc')

  // 写入头部: salt(16) + iv(12)
  output.write(salt)
  output.write(iv)

  await pipeline(input, cipher, output)

  // 写入认证标签
  const authTag = cipher.getAuthTag()
  fs.appendFileSync(zipPath + '.enc', authTag)

  // 删除原始未加密文件
  fs.unlinkSync(zipPath)
}

async function decryptBackup(encPath: string, password: string) {
  const data = fs.readFileSync(encPath)

  // 解析头部
  const salt = data.subarray(0, 16)
  const iv = data.subarray(16, 28)
  const authTag = data.subarray(-16)
  const encrypted = data.subarray(28, -16)

  // 密钥派生
  const key = crypto.scryptSync(password, salt, 32, { N: 2 ** 14, r: 8, p: 1 })

  // 解密
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])

  const zipPath = encPath.replace('.enc', '')
  fs.writeFileSync(zipPath, decrypted)

  return zipPath
}
```

### 9.2 密钥派生参数

| 算法 | 推荐参数 | 说明 |
|------|----------|------|
| **scrypt** (Node.js 内置) | N=2^14, r=8, p=1 | 平衡安全与性能 |
| **Argon2id** (需 argon2 库) | memory=64MB, iterations=3, parallelism=2 | 更高安全性，抗 GPU |
| **PBKDF2** (不推荐) | iterations=300,000+ | 抗 GPU 能力弱 |

**Electron 环境建议**: 使用 `crypto.scrypt`（Node.js 内置），避免原生模块依赖问题。

### 9.3 manifest.json 加密信息

```typescript
interface EncryptionInfo {
  algorithm: 'AES-256-GCM'
  kdf: 'scrypt' | 'argon2id'
  // scrypt 参数
  N?: number
  r?: number
  p?: number
  // argon2 参数
  memoryCost?: number
  timeCost?: number
  parallelism?: number
  // 公共
  salt: string  // Base64
}
```

---

## 十、关键设计决策

| 决策点 | 方案 | 理由 |
|--------|------|------|
| ZIP 生成 | `archiver` (zlib level 6) | 流式写入、背压处理、ZIP64 支持 |
| ZIP 读取 | `yauzl` + `unzipper` | yauzl 随机访问、unzipper 流式解析 |
| 数据格式 | JSONL | 流式读写、突破 512MB 限制 |
| 校验算法 | xxHash | 10x 快于 SHA-256、适合非加密校验 |
| Base64 图片 | **必须分离存储** | 单行 JSON 过大导致解析崩溃 |
| 数据源 | DataApiService | 与 V2 架构对齐 |
| 版本迁移 | VersionMigrator | 向后兼容 V5 及更早 |
| 错误处理 | 原子写入 + 事务回滚 | 提高可靠性 |
| 增量备份 | 时间戳检测 + 软删除 | 轻量级实现 |
| 加密 | 压缩后 AES-256-GCM | 安全性高、兼容性好 |
| 密钥派生 | scrypt (Node.js 内置) | 抗 GPU、无原生模块依赖 |

---

## 十一、文件变更清单

### 需修改

| 文件 | 说明 |
|------|------|
| `src/main/services/BackupManager.ts` | 简化为纯文件 I/O |
| `src/renderer/src/services/BackupService.ts` | 迁移到新架构 |

### 需新建

```
packages/shared/backup/
├── types.ts           # BackupManifest, BackupDomain, IncrementalManifest
├── options.ts         # BackupOptions, RestoreOptions, ConflictStrategy
├── tree.ts            # MessageTreeRef
└── compat.ts          # 版本兼容性, VERSION_COMPATIBILITY

src/main/services/backup/
├── orchestrator/
│   ├── BackupOrchestrator.ts      # 编排导出/导入流程
│   ├── StreamSerializer.ts        # JSONL 流式序列化
│   ├── StreamParser.ts            # JSONL 流式解析
│   └── VersionMigrator.ts         # V5 → V6 迁移
├── exporters/
│   ├── BaseExporter.ts            # 抽象基类
│   ├── TopicExporter.ts           # 对话 + 消息
│   ├── PreferenceExporter.ts
│   ├── ProviderExporter.ts
│   ├── AssistantExporter.ts
│   ├── KnowledgeExporter.ts
│   ├── MemoryExporter.ts
│   └── FileExporter.ts            # 附件文件 (Base64 分离)
├── importers/
│   ├── BaseImporter.ts
│   ├── TopicImporter.ts
│   ├── ConflictResolver.ts        # ID 冲突解决
│   └── ...
├── validators/
│   └── BackupValidator.ts         # 校验和验证
├── incremental/
│   ├── ChangeDetector.ts          # 变更检测
│   └── BackupChainManager.ts      # 备份链管理
└── encryption/
    └── BackupEncryptor.ts         # AES-256-GCM 加密/解密
```

### 新增依赖

```json
{
  "dependencies": {
    "archiver": "^7.0.0",
    "yauzl": "^3.0.0",
    "unzipper": "^0.12.0",
    "xxhash-wasm": "^1.0.0"
  },
  "devDependencies": {
    "@types/archiver": "^6.0.0",
    "@types/yauzl": "^2.10.0"
  }
}
```

---

## 十二、验证计划

### 单元测试

1. **StreamSerializer**: 生成 JSONL 字符串、背压处理
2. **StreamParser**: 逐行解析、错误行跳过
3. **各 Exporter**: 序列化输出格式正确
4. **各 Importer**: 反序列化 + ID 映射
5. **BackupValidator**: 校验和验证、版本兼容性检查
6. **ChangeDetector**: 增量检测逻辑

### 集成测试

1. 完整备份 → 恢复流程
2. 增量备份 → 恢复流程
3. V5 备份文件导入
4. 加密备份 → 解密恢复

### 压力测试

```typescript
// 生成 1GB 模拟数据测试
async function stressTest() {
  const testData = generateLargeDataset(1024 * 1024 * 1024)  // 1GB

  console.time('backup')
  await createBackup(testData, 'stress-test.zip')
  console.timeEnd('backup')

  // 监控内存峰值
  const memoryPeak = getMemoryPeakDuringOperation()
  assert(memoryPeak < 500 * 1024 * 1024, 'Memory should stay under 500MB')
}
```

### 跨平台测试

1. macOS 生成 → Windows 恢复
2. Windows 生成 → Linux 恢复
3. 验证文件名编码（中文、特殊字符）
4. 验证时间戳一致性

### 兼容性测试

1. V5 备份文件（localStorage + indexedDB 格式）导入
2. 验证数据完整性（记录数、内容哈希）

---

## 十三、参考资料

1. [archiver 文档](https://www.archiverjs.com/docs/archiver/)
2. [yauzl GitHub](https://github.com/thejoshwolfe/yazl)
3. [sqlite-history](https://simonwillison.net/2023/Apr/15/sqlite-history/) - SQLite 触发器记录变更
4. [Node.js 背压处理](https://nodejs.org/en/learn/modules/backpressuring-in-streams)
5. [OWASP PBKDF2 建议](https://neilmadden.blog/2023/01/09/on-pbkdf2-iterations/)

---

**文档版本**: v2.1-draft
**创建日期**: 2025-01-21
**更新日期**: 2025-01-29
