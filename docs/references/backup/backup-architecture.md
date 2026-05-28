# V2 备份系统 — 架构与设计文档

## 概述

V2 备份系统是对 Cherry Studio 备份功能的全面重构，替代了原有基于 JSON 序列化（v1 `BackupManager`）的方案，采用 **SQLite VACUUM INTO + 域选择式备份** 架构。

### 改动量级

| 类别 | 文件数 | 代码行数 |
|------|--------|----------|
| 共享类型定义 (`packages/shared/backup/`) | 4 | 270 |
| 核心实现 (`src/main/services/backup/`) | 16 | 2,354 |
| 测试 (`__tests__/`) | 12 | 1,472 |
| **总计** | **32** | **~3,800** |

涉及 20 个专项提交，覆盖从类型定义到完整导出/恢复管道的实现。

---

## 1. 核心问题

V1 备份系统存在以下致命缺陷：

| 问题 | 严重度 | 说明 |
|------|--------|------|
| `JSON.stringify` 超 512MB 触发 V8 OOM | Critical | 直接崩溃 |
| 不支持选择性备份 | High | 只能全量备份 |
| V2 数据存储在 SQLite，不在 IndexedDB | Critical | V1 方案完全无法读取 V2 数据 |
| 恢复时无数据验证 | High | 无法检测损坏的备份 |
| 全目录复制包含无用文件 | Medium | 浪费空间 |

---

## 2. 架构设计

### 2.1 策略：VACUUM INTO + 选择性剥离

```
导出流程:
  活跃 SQLite DB ──VACUUM INTO──→ backup.sqlite (原子全量快照)
                                        │
                                  ┌─────▼──────┐
                                  │ DomainStripper │  删除未选中域的表
                                  └─────┬──────┘
                                        │
  引用文件流复制 ──────────────→ files/
  知识库向量 DB 复制 ──────────→ knowledge/
                                        │
                                  ┌─────▼──────┐
                                  │ archiver    │  ZIP + manifest.json
                                  │ (zlib L6)   │  + checksums.json
                                  └─────────────┘

恢复流程:
  ZIP ──解压──→ backup.sqlite + files/
                    │
              ┌─────▼──────┐
              │ BackupValidator │  校验 manifest、checksums、schema
              └─────┬──────┘
                    │
              ┌─────▼──────┐
              │ DomainImporter │  按域导入，支持冲突策略
              └─────┬──────┘
                    │
              ┌─────▼──────┐
              │ FileRestorer   │  恢复文件 + 重建 FTS 索引
              └─────────────┘
```

### 2.2 两种备份模式

| 模式 | 实现路径 | 适用场景 |
|------|----------|----------|
| **全量 (Full)** | `VACUUM INTO` → `DomainStripper` 剥离未选中域 | 备份大部分域时更高效 |
| **选择性 (Selective)** | `SelectiveExport` 从空 DB 构建，仅复制选中域 | 仅备份少量域时更轻量 |

两种模式最终产出格式相同（ZIP 内含 `backup.sqlite` + `manifest.json` + `files/` + `knowledge/`）。

### 2.3 服务架构

```
┌─────────────────────────────────────────────────────────────┐
│  packages/shared/backup/          ← 跨进程共享类型           │
│  types.ts · options.ts · validation.ts · index.ts            │
├─────────────────────────────────────────────────────────────┤
│  src/main/services/backup/                                    │
│  ├── BackupService.ts           (Lifecycle 服务，IPC 入口)   │
│  ├── CancellationToken.ts       (取消令牌)                   │
│  ├── orchestrator/                                           │
│  │   ├── ExportOrchestrator.ts  (全量导出管道)               │
│  │   ├── ImportOrchestrator.ts  (恢复管道)                   │
│  │   ├── SelectiveExport.ts     (选择性导出)                 │
│  │   └── BackupValidator.ts     (备份验证)                   │
│  ├── domain/                                                 │
│  │   ├── DomainRegistry.ts      (域→表映射 + 导入顺序)      │
│  │   ├── DomainStripper.ts      (全量模式域剥离)             │
│  │   ├── DomainImporter.ts      (批量导入 + 冲突处理)        │
│  │   └── IdRemapper.ts          (RENAME 策略 ID 重映射)     │
│  ├── files/                                                  │
│  │   ├── FileCollector.ts       (消息文件引用扫描)           │
│  │   └── FileRestorer.ts        (文件恢复)                   │
│  ├── filters/                                                │
│  │   └── PreferenceFilter.ts    (跨平台偏好过滤)             │
│  ├── progress/                                               │
│  │   └── BackupProgressTracker.ts (进度追踪)                 │
│  └── utils/                                                  │
│      └── checksum.ts            (SHA-256 校验)               │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 域模型 (Domain Model)

### 3.1 备份域与数据库表映射

系统将 28 张 SQLite 表组织为 12 个独立备份域 + 2 个基础设施表：

| 域 | 数据库表 | 文件资产 | 阶段 |
|----|----------|----------|------|
| `PREFERENCES` | `preference` | — | P1 |
| `PROMPTS` | `prompt` | — | P1 |
| `MCP_SERVERS` | `mcp_server` | — | P1 |
| `TAGS_GROUPS` | `tag`, `entity_tag`, `group` | — | P1 |
| `KNOWLEDGE` | `knowledge_base`, `knowledge_item` | 向量 DB 目录 | P1 |
| `TOPICS` | `topic`, `message`, `pin` | 消息引用的文件 | P1 |
| `TRANSLATE_HISTORY` | `translate_language`, `translate_history` | — | P1 |
| `FILE_STORAGE` | `file_entry`, `file_ref` | `Data/Files/` 全部 | P1 |
| `PROVIDERS` | `user_provider`, `user_model` | — | P2 |
| `ASSISTANTS` | `assistant`, `assistant_mcp_server`, `assistant_knowledge_base` | — | P2 |
| `AGENTS` | `agent` + 8 张关联表 | — | P2 |
| `MINIAPPS` | `mini_app` | — | P2 |

**明确排除**（运行时状态，不备份）：
- `app_state` — 通用键值存储，运行时状态
- `message_fts` — FTS5 虚拟表，恢复后重建
- `job`、`job_schedule` — 后台任务队列，运行时状态

### 3.2 导入顺序 (IMPORT_ORDER)

按外键依赖关系排序，确保被引用的表先导入：

```
PREFERENCES → PROMPTS → MCP_SERVERS → TAGS_GROUPS → KNOWLEDGE → TOPICS →
TRANSLATE_HISTORY → FILE_STORAGE → PROVIDERS → ASSISTANTS → AGENTS → MINIAPPS → SKILLS
```

跨域 FK 引用（如 `topic.assistant_id → assistant.id`）在导出时通过 `DomainStripper` 的 `CROSS_DOMAIN_FK_RULES` 置空处理，不依赖导入顺序。

---

## 4. 核心流程

### 4.1 导出 (Export)

1. 创建临时目录
2. **全量模式**：`VACUUM INTO` 原子复制 → `DomainStripper` 剥离未选中域
   **选择性模式**：`SelectiveExport` 创建空 DB → 运行 Drizzle 迁移 → `ATTACH` 或双客户端批量复制选中域数据
3. 应用 `CROSS_DOMAIN_FK_RULES`（置空或删除跨域 FK 引用）
4. `PreferenceFilter` 过滤敏感偏好（凭证、平台路径、快捷键等）
5. `DomainStripper`/`SelectiveExport` 清空 `user_provider.api_keys` 和 `auth_config`（除非 `includeSensitiveData` 开启）
6. `FileCollector` 扫描消息文件引用 → 复制文件
7. 复制知识库向量 DB 目录
8. SHA-256 计算所有文件校验和
9. 生成 `manifest.json`（版本、域统计、schema hash、设备信息）
10. `archiver` 打包为 ZIP（zlib level 6）
11. 原子重命名 `.tmp` → 最终路径，清理临时目录

### 4.2 恢复 (Restore)

1. 解压 ZIP → 临时目录
2. `BackupValidator` 校验：
   - manifest 版本 ≤ `BACKUP_MANIFEST_VERSION`
   - 所有文件 SHA-256 校验和
   - schema 版本兼容性（备份更新则阻止，备份更旧则警告）
3. 按 `IMPORT_ORDER` 逐域导入：
   - 每域独立事务（单域失败不回滚其他已成功域）
   - 批量 500 行读取备份 DB，写入活跃 DB
   - 应用冲突策略（见 §4.3）
4. `FileRestorer` 恢复文件（大小相同则跳过）
5. 重建 `message_fts`（DROP → CREATE → FTS5 `rebuild`）
6. 清理临时目录

### 4.3 冲突策略

| 策略 | 行为 | 适用场景 |
|------|------|----------|
| `SKIP` | `ON CONFLICT DO NOTHING` | 保留本地数据，不覆盖 |
| `OVERWRITE` | `ON CONFLICT UPDATE` | 以备份数据为准 |
| `RENAME`（默认） | 为冲突 ID 生成新 UUID，更新所有 FK 引用 | 保留双方数据 |

RENAME 策略通过 `IdRemapper` 实现两阶段映射：
1. **扫描阶段**：检测备份 ID 与活跃 DB 的冲突，构建 `Map<oldId, newId>`
2. **写入阶段**：所有 FK 列值通过映射表替换后写入

特殊处理：
- `agent_global_skill`、`tag` 等 UNIQUE 约束表使用 `tryUniqueMerge`（内容相同则复用已有 ID）
- `user_provider` 在 OVERWRITE 时保留本地的 `api_keys` 和 `auth_config`（不覆盖凭证）

### 4.4 跨域 FK 处理

9 条 `CROSS_DOMAIN_FK_RULES` 在导出时处理跨域引用：

| 规则 | 动作 |
|------|------|
| `topic.assistant_id` → ASSISTANTS | SET_NULL |
| `topic.group_id` → TAGS_GROUPS | SET_NULL |
| `message.model_id` → PROVIDERS | SET_NULL |
| `assistant.model_id` → PROVIDERS | SET_NULL |
| `assistant_mcp_server.mcp_server_id` → MCP_SERVERS | DELETE_ROW |
| `assistant_knowledge_base.knowledge_base_id` → KNOWLEDGE | DELETE_ROW |
| `knowledge_base.embedding_model_id` → PROVIDERS | SET_NULL |
| `knowledge_base.rerank_model_id` → PROVIDERS | SET_NULL |
| `knowledge_base.group_id` → TAGS_GROUPS | SET_NULL |

---

## 5. ZIP 包结构

```
backup_v2.zip
├── manifest.json          # 元数据：版本、域、统计、校验和
├── checksums.json         # SHA-256 文件校验和
├── backup.sqlite          # 域剥离后的 SQLite 快照
├── files/                 # 消息引用的文件
│   ├── {uuid1}.png
│   └── {uuid2}.pdf
└── knowledge/             # 知识库向量 DB（可选）
    └── {baseId}/
        └── *.db
```

### Manifest 结构

```typescript
{
  version: 6,                    // BACKUP_MANIFEST_VERSION
  mode: 'full' | 'selective',
  appVersion: string,
  platform: string,
  arch: string,
  createdAt: string,             // ISO 8601 UTC
  schemaVersion: { hash, createdAt },
  domains: BackupDomain[],
  domainStats: Record<string, { itemCount, sizeBytes }>,
  checksums: Record<string, string>,
  sourceDevice: { hostname, os }
}
```

---

## 6. 选择性导出的两种实现路径

### 6.1 ATTACH 策略（优先）

```sql
ATTACH DATABASE '/path/to/live.db' AS live;
INSERT INTO main.topic SELECT * FROM live.topic;
```

高效的单次 `INSERT...SELECT`，但不兼容 WAL 模式。

### 6.2 双客户端回退

当 ATTACH 失败时（如 WAL 锁定），使用基于游标分页的双客户端复制：
- 备份端：`SELECT * FROM topic WHERE rowid > ? ORDER BY rowid LIMIT 500`
- 活跃端：批量 `INSERT` 500 行

自动回退，无需用户干预。

---

## 7. 安全与跨平台

### 7.1 凭证处理

- **导出时**：`DomainStripper` 清空 `user_provider.api_keys`（设为 `[]`）和 `auth_config`（设为 NULL）
- **恢复时**：OVERWRITE 策略保留本地的凭证字段不覆盖

### 7.2 偏好过滤 (PreferenceFilter)

5 类过滤规则确保跨平台安全：

| 分类 | 处理 | 匹配规则 |
|------|------|---------|
| 敏感凭证 | 排除 | key/value 匹配 `secret|token|password|api_key|credential` |
| 机器状态 | 排除 | 精确匹配 `app.zoom_factor`, `app.window_state` 等 |
| 平台路径 | 排除 | value 匹配绝对路径 (`^/` 或 `^[A-Z]:\\`) |
| 平台快捷键 | 排除 | key 匹配 `shortcut.*` 且含 `CommandOrControl` |
| 安全偏好 | 保留 | 默认不匹配任何排除规则 |

### 7.3 Schema 兼容性

| 情况 | 处理 |
|------|------|
| 备份 = 活跃 | 直接导入 |
| 备份 < 活跃 | 警告后尝试（缺失列忽略，新列用默认值） |
| 备份 > 活跃 | **阻止导入**，提示升级应用 |

---

## 8. 操作管理

### 8.1 进度追踪

`BackupProgressTracker` 实时报告：
- 当前阶段（vacuum / strip / copy / compress / import / rebuild）
- 每域进度百分比
- 已处理项数 / 总项数
- 预估剩余时间

`BackupService` 每 200ms 向所有渲染窗口广播进度。

### 8.2 取消机制

`CancellationToken` 在每个长操作的循环中检查：
- `ExportOrchestrator`：文件复制、表处理循环中检查
- `ImportOrchestrator`：域导入循环中检查
- `SelectiveExport`：表复制循环中检查

取消后自动清理临时文件。

---

## 9. 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 备份策略 | VACUUM INTO + 选择性剥离 | 原子快照，消除 512MB JSON 限制 |
| 选择性备份 | 双模式（ATTACH + 双客户端回退） | ATTACH 高效但不兼容 WAL；自动回退保证可靠性 |
| ZIP 生成 | `archiver` (zlib L6) | 流式写入、背压处理、ZIP64 支持 |
| ZIP 读取 | `node-stream-zip` | 项目统一方案，无新依赖 |
| 校验算法 | SHA-256 (`node:crypto`) | 内置模块，零依赖，瓶颈在 IO 不在哈希 |
| ID 冲突 | 默认 RENAME（UUID 重映射） | 双方数据完整保留 |
| 事务粒度 | 每域独立事务 | 单域失败不影响其他域 |
| FTS 重建 | DROP + CREATE + `rebuild` 命令 | 避免逐行触发器开销 |
| IPC vs DataApi | IPC | 备份是副作用操作（文件系统 I/O），不满足 DataApi 条件 |
| 凭证处理 | 导出清空 + 恢复保留 | 机器级敏感数据不应跨设备传输 |

---

## 10. 依赖

全部使用项目已有依赖，无新增：

| 包 | 用途 |
|----|------|
| `archiver` | ZIP 生成 |
| `node-stream-zip` | ZIP 读取/解压 |
| `@libsql/client` | 操作 backup.sqlite |
| `node:crypto` | SHA-256 校验 |

---

## 11. 与 V1 的关系

- V1 `BackupManager.ts` **保留不修改**，V2 完全替代前仍需支持 V1 格式
- V2 是独立管道，不依赖 V1 任何代码
- V1 格式导入由 `MigrationEngine` 处理，不在 V2 备份系统范围内

---

## 12. 已知架构缺口与演进方向

### 12.1 模块私有文件资源未覆盖

当前文件收集只处理 `Data/Files/` 目录下由 `FileCollector`（基于消息块 `fileId`）和全量 FILE_STORAGE 域复制覆盖的文件。

以下模块私有文件资源**未纳入备份**，恢复后丢失不影响核心数据完整性，但用户需重新下载/生成：

| 资源 | 位置 | 影响 |
|------|------|------|
| Agent 会话附件（非消息流） | 模块私有目录 | 需重新上传 |
| MCP 服务端缓存 | 模块私有目录 | 需重新生成 |

**演进方向**：将文件资源发现从硬编码的 `FileCollector` 迁移到声明式注册机制，让各模块自行声明其文件资源。参见 §12.2 的 `BackupContributor` 方向。

### 12.2 域知识所有权中心化与演进

当前所有域→表映射、跨域 FK 规则、FTS 重建逻辑、偏好过滤规则集中在备份模块内部：

- `DomainRegistry.ts` — 域→表映射
- `DomainStripper.ts` — 跨域 FK 规则
- `DomainImporter.ts` — FTS 重建（硬编码表名）
- `PreferenceFilter.ts` — 偏好过滤规则

这些规则与业务模块（agents、assistants、knowledge 等）强耦合，但业务模块无法声明自己的备份行为。新增业务表需要手动更新备份模块的多处文件。

**演进方向**：引入 `BackupContributor` 接口，让各业务模块声明式注册：

```typescript
interface BackupContributor {
  domain: BackupDomain
  tables: string[]
  crossDomainFkRules?: CrossDomainFkRule[]
  fileResources?: (db: Client) => Promise<Set<string>>
  restoreInvariants?: (tx: Transaction) => Promise<void>
  // ... 其他扩展点
}
```

此方向为架构演进目标，不在当前 PR 范围内实施。当前方案通过 `DomainRegistry.coverage.test.ts` 覆盖守卫确保新增表不会被遗漏。

### 12.3 FILE_STORAGE 域的 RENAME 策略限制

`file_entry` 和 `file_ref` 使用 UUID v7 主键。`IdRemapper` 和 `FK_REMAP_RULES` 当前未覆盖 FILE_STORAGE 域的表，因此在 RENAME 冲突策略下：

- `file_entry` ID 与本地冲突时 → `ON CONFLICT DO NOTHING`，跳过该行
- `file_ref` 的 `file_entry_id` 和 `source_id` 不会重映射
- `FileRestorer` 在 RENAME 模式下遇到同名文件直接跳过

实际风险较低（跨设备 UUID v7 碰撞概率极小），但不是零。完整修复需要：
1. 将 `file_entry` 加入 `IdRemapper` 的 V7_TABLES
2. 为 `file_ref` 添加 `FK_REMAP_RULES` 条目（`id`, `file_entry_id`）
3. 处理 `file_ref.source_id` 的多态重映射（按 `sourceType` 分发到对应域的 ID 映射）
4. `FileRestorer` 支持 RENAME 模式下复制文件到新 ID 路径
