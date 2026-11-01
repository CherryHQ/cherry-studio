# Agent Note: 文件条目在字节复制期间使用 `preparing`

Status: proposed

[English](2026-10-21-knowledge-file-preparing-state.md) | 中文

## 问题

自从[在库级写锁之外复制来源文件](2026-10-21-knowledge-async-source-copy.md)之后，文件条目的行在字节进入 `raw/` 之前就已存在，但它的状态和其他叶子条目一样是 `processing`。行上没有任何信息表明字节尚未落盘，由此留下三个缺口：

- 列表无法区分仍在等待复制的文件和已经在处理中的文件。
- 预览这样的文件（`knowledge.get_file_path`）会解析到一个尚不存在的 `raw/` 路径。
- 恢复知识库时会探测并复制每个文件在库内的副本，因此仍在等待复制的文件会被当作来源缺失而跳过。

`preparing` 已经为目录表达了「正在获取来源」，但 `knowledge_item_type_status_check` 约束和实体 schema 都把它限制为只能用于目录条目。

## 提案

- 把 `preparing` 的含义放宽为「条目的来源正在被获取进知识库」，并在数据库约束（一次重建表的迁移）、实体 schema 和共享的状态机注释中允许文件条目使用它。URL 和笔记条目的状态保持不变。
- `addItems` 把仍欠复制的文件行创建为 `preparing`（`createActive(..., { awaitingCopy: true })`）。`knowledge.copy-sources` 在提交重命名的同一个锁段内把它改为 `processing`，然后调度下一阶段。恢复在调用内复制，重建索引期间旧字节仍在磁盘上，因此两者都保持 `processing`。
- 需要读取字节的读取方在文件处于 `preparing` 时回退到原文件：预览返回 `data.source`，恢复探测并复制 `data.source`。
- 其余情况已有处理覆盖：启动扫描会把在途的 `preparing` 行标为失败（被中断的复制变为 `indexing_interrupted`），重建索引准入会拒绝它们，渲染进程把它们当作非终态继续轮询，并显示为「等待中」（`status.pending`）而不是「处理中」。

不在本次范围内：UI 上的复制进度；URL 条目使用 `preparing`，因为 URL 只有在带快照恢复时才需要复制，而恢复是在调用内复制的；以及收紧 `knowledge.add_items` 的 IPC schema，使仅供恢复使用的 `snapshotPath` / `indexedPath` 字段不能从渲染进程传入（作为后续事项）。

## 考虑过的替代方案

- 用 `idle` 表示「字节尚未落盘」：不需要迁移，但启动扫描、重建索引准入和渲染进程都不会推动 `idle` 行往前走，复制任务一旦丢失，对应的行就会卡住。
- 保持 `processing`，由每个读取方自行探测磁盘：文件不存在时无法区分「仍在复制」和「复制失败或丢失」，而且每个读取方都要重复实现同一套猜测。
- 新增一个专用状态（例如 `copying`）：它必须贯穿状态枚举、两条约束、启动扫描、重建索引准入和 UI，而它表达的含义 `preparing` 已经具备。

## 验收标准

- AC1 — 通过异步复制添加的文件在字节落盘之前以 `preparing` 列出，显示为「等待中」而不是「处理中」，之后再转为 `processing`。 (verification: unit + renderer)
- AC2 — 迁移之后，文件行可以处于 `preparing`，笔记或 URL 行仍然不可以，且已有的行和子条目级联删除都得以保留。 (verification: unit)
- AC3 — 预览一个 `preparing` 的文件会打开它的原文件。 (verification: unit)
- AC4 — 恢复知识库时，`preparing` 的文件会从原文件复制，而不是被当作来源缺失而跳过。 (verification: unit)
- AC5 — 因退出应用或崩溃而中断的复制，会让对应的 `preparing` 文件以 `indexing_interrupted` 失败。 (verification: unit)

## 风险

- 迁移会重建 `knowledge_item` 表。`applyMigrations` 在迁移事务之外关闭了外键，因此重建不会触发级联删除，但耗时会随条目行数增长。
- 预览 `preparing` 的文件读取的是用户的原文件；如果原文件在此期间被移走，预览会像其他文件缺失时一样失败，而复制本身也会让该条目失败。
