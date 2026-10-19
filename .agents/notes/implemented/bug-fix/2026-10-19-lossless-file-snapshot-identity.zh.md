# Agent Note: 无损文件快照身份

Status: implemented

[English](2026-10-19-lossless-file-snapshot-identity.md) | 中文

## Problem

`openReadableFileSnapshot` 比较路径及已打开句柄的设备号/inode，并将该身份传给诊断收集和上传检查。Number 类型的 stat 会把超过 `2^53` 的不同 64 位文件 ID 舍入为同一个值。此时相同的大小和毫秒修改时间不能可靠发现文件替换。现有 `isSameFile` 已使用 BigInt stat 规避 NTFS 的这一限制，快照读取尚未沿用。

## Decision

路径及句柄 stat 均启用 Node 的 `bigint` 选项，内部快照和诊断源身份始终保留 BigInt 设备号/inode。字节数维持数值类型，以兼容现有流合同。修改时间从同一个句柄的 Number stat 获取并向下取整，与现有乐观写入版本校验保持一致；BigInt `mtimeMs` 的截断可能在毫秒边界与 Number 舍入不同。构造数值流长度前，拒绝超出安全整数范围的文件大小。

## Alternatives considered

- Number 身份在比较前已经丢失信息，事后转换为 BigInt 无法恢复。
- 延迟测试或修改时间戳会掩盖碰撞，文件身份检查仍不安全。
- 十进制字符串也能保留身份，但会为完全位于进程内的比较增加转换。这些身份不会序列化到诊断清单、IPC 响应或持久化行。

## Consequences

快照消费者继续通过已打开句柄定长读取，并保留现有的替换拒绝行为。诊断仍可对身份完全相同、持续增长的日志暂存已检查前缀。仅修改内部身份类型和一个测试 fixture，不改变传输、持久化或 Provider 行为。

确定性大 ID 回归可在任意平台证实精度缺陷。已观察的 Windows 诊断测试失败发生在 Skills 搜索 diff 之外，但失败运行未记录文件 ID；本修复不证明那次运行的精确根因。Windows CI 仍需作为独立证据。

## Verification

- Regression — `src/main/utils/file/__tests__/readableFileSnapshot.test.ts`：拒绝转换成 Number 后碰撞的不同设备号/inode；保留准确大 ID 并正常读取；拒绝不安全的流长度。
- Regression — `src/main/ai/agents/__tests__/heartbeatDocument.test.ts` 和 `src/main/utils/file/__tests__/fs.test.ts`：亚毫秒时间戳读出的快照版本仍允许保存未被外部改动的文件，同时继续拒绝过期编辑。
- Regression — `src/main/services/diagnostics/__tests__/sourceCollector.test.ts`：真实文件覆盖替换拒绝、增长日志前缀和记录筛选。
- Regression — `src/main/services/diagnostics/__tests__/CherryDiagnosticUploadClient.test.ts`：现有文件变更和上传检查覆盖快照消费者。
