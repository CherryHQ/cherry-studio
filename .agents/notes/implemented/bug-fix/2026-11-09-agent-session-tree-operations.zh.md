# Agent Note: Session 投递修改与消息树查询成本

Status: implemented

[English](2026-11-09-agent-session-tree-operations.md) | 中文

## Problem

Session 消息 PATCH 允许修改投递中的正文，而 DELETE 会拒绝同一条未完成投递。处于 `accepted` 或 `delivering` 时可能尚未建立原生输入绑定，因此仅检查绑定无法保护已派发的指令。

分支导航对每个后继节点执行一次 ORM 查询。SQLite 可能选择会话时间索引，在每一层重新扫描会话。平铺历史补树也对每条消息执行一次 ORM 更新，分页结果组装则重复扫描同一批兄弟节点。

## Decision

在写事务内拒绝 `accepted` 和 `delivering` 消息的公共 PATCH，在修改正文、附件、检查点或时间戳之前返回错误。终态展示消息的行为保持不变。这恢复了[运行时契约](../../proposed/architecture/2026-10-17-agent-runtime-contract.md)中的输入不可变边界。

通过一次递归查询解析分支，在每一层按 `(created_at, id)` 选择最新的直接子节点。排序时间戳前的一元 `+` 避免走会话时间索引的排序捷径；现有 `(session_id, parent_id)` 索引将每次查找限制在该父节点的子节点内。分页兄弟节点按父节点一次分组。

平铺历史重构由[存储约束决策](2026-11-09-session-tree-storage-constraints.md)中的追加迁移负责。启动时的 `AgentSessionMessageTreeSeeder` 仅初始化空 Session 的 root 和选择状态，并回填遗留投递回复锚点。已有非空树及其选择状态保持不变，包括未选中头节点的状态。直接 SQL 夹具通过 `linkSessionMessageChain` 显式按预期消息 ID 顺序串联。

针对 #23359，先仅查询分页 ID、父节点和时间戳，再使用一个预编译主键查询逐条加载正文。在请求 `deferToolOutputs` 时立即投影每条 assistant 消息，避免投影期间同时保留整页原始工具输出，也不解码用于探测下一页的额外行。默认读取仍返回完整数据。最多 200 次同步逐行查询换取更小的存活正文集合。

共享工具输出投影复用 32 KiB UTF-8 传输检查得到的超大 JSON 字符串，计算引用的 revision。每次存储消息或实时流片段投影只序列化一次原始输出，保持现有哈希格式，无需持久缓存。

## Alternatives considered

- 只在 UI 禁用操作，仍会让公共 PATCH 端点可写。
- 选择整个子树中最新的叶子节点，会改变 Session 导航语义。
- 持久化路径缓存需要额外的失效管理；索引查询修复无需持久缓存。独立的[存储约束决策](2026-11-09-session-tree-storage-constraints.md)负责表结构迁移和平铺历史回填。

## Consequences

分页保留时间戳/ID 游标，仍会遍历选中路径的祖先。这些改动不代表分页遍历深度已有上限，也不代表 Electron 渲染性能已经验证。执行仍以原生历史为准；修改展示行不等于回滚原生历史。

单条超大消息及未启用投影的读取仍可能消耗大量内存。其他全量历史消费者及原生进程崩溃不在本次修复范围内，不能据此认定 #23359 的所有症状已解决。

## Verification

- Regression — `AgentSessionMessageService.test.ts` 验证未完成投递的 PATCH 被拒绝且不改变原行。迁移证据记录在[存储约束决策](2026-11-09-session-tree-storage-constraints.md)中。
- Regression — `agentSessionMessageTree.test.ts`：直接子节点排序、相同时间戳、兄弟节点、空会话、重复初始化及延迟回复保持原有契约。启动初始化保留已选中或未选中头节点的非空分支，并在不改变时间戳的情况下初始化空会话缺失或已有的 root。

本地服务测量使用相同的文件型 SQLite 测试数据，交替执行优化前后操作。耗时观察不代表打包应用或真实供应商验收。

- Regression — 分页投影保留原始存储、小输出、旧页游标及默认完整读取；在探测行解码器中设置断言，防止读取当前页之外的正文。
- 本地内存探针 — 存储 80 条、每条含 1 MiB 工具输出的消息，读取默认 50 条页面：在每次解码边界强制 GC 后采样，存活 JS 堆最大增量从修前 102.0 MiB 降到修后 2.2 MiB。该结果衡量保留的正文，不代表峰值 RSS。16 MiB SQLite 堆限制测试没有复现 SQLITE_NOMEM。

- Regression — `messageOutputProjection.test.ts` 在存储及实时路径中拒绝同一输出被二次序列化，并检查引用的固定 revision；恰好达到阈值、超限、CJK 和持久化引用骨架用例保持传输行为。
