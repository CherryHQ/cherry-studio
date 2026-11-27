# Agent Note: memory MCP 图谱只保存在磁盘上

Status: implemented

[English](2026-11-26-memory-mcp-disk-state.md) | 中文

## 问题

内置 `@cherry/memory` server 启动时把 `memory.json` 一次性读进内存图谱，每次修改后再写回。写盘失败时修改仍留在内存里，重试 `create_entities` 会把该实体当作已存在而跳过，永远不会写入文件。`add_observations` 中某一项失败时，前面几项已在内存里被修改。无法解析的文件会被空图谱覆盖，结构不对的合法 JSON 文件会让启动失败。

## 决策

记忆文件是唯一的状态。每次工具调用都在同一把锁里读取文件，修改作用在这份新读出的副本上，再用 `atomicWriteFile` 写回，调用失败时修改直接丢弃。读写前会把符号链接解析到真实文件，并保留文件原有权限。文件用宽松的 schema 校验：缺少 `observations`、`entities` 或 `relations` 时补为空，实体上的未知字段会保留。无法解析或结构不对的文件会被改名为 `memory.json.corrupt-<timestamp>`，server 从空图谱开始。

## 考虑过的替代方案

保留内存缓存、写盘失败时回滚，只能修复写入路径；缓存仍会忽略应用运行期间对文件的手动编辑，并在下次写入时覆盖它们。覆盖损坏文件会丢失用户数据；结构不对时让每次调用都失败，会让 server 无法使用。

## 后果

每次工具调用都会读取并解析整个文件，对这种规模的知识图谱可以接受。`memory.json` 改为第一次写入时创建，不再在启动时创建。应用运行期间的手动编辑会在下一次调用时生效。`read_graph` 这类只读调用也可能把损坏文件挪到一边。

## 验证

- 回归 — `memory.test.ts` 的 "persists an entity when the call is retried after a failed write"：在内存实现上会失败，因为重试的实体始终没有写入。
- 回归 — `memory.test.ts` 的 "leaves earlier entities untouched when add_observations fails on a later one"：捕获调用失败后仍残留部分修改的问题。
- 回归 — `memory.test.ts` 的 "moves a memory file holding … aside"：覆盖 JSON 被截断、`null`、实体不是数组三种情况，确认文件被备份而不是被覆盖。
- 回归 — `memory.test.ts` 的 "reads a memory file whose entities lack observations and that has no relations"：捕获 schema 过严、把可读文件挪走的问题。
- 回归 — `memory.test.ts` 的 "writes through a symlinked memory path" 和 "keeps the permissions of an existing memory file"：捕获原子改名替换符号链接或重置权限的问题。
