# Agent Note: 原子写入刷新原始写句柄

Status: implemented

[English](2026-11-22-atomic-write-flush-handle.md) | 中文

## Problem

原子写入器关闭临时输出后，在提交时使用 `r+` 重新打开以刷新并读取状态。目标文件系统可能接受顺序写入，却拒绝读写重开。[Issue #25004](https://github.com/CherryHQ/cherry-studio/issues/25004) 报告了 GVfs/SMB 上备份完成时的这类故障。源码确有报告中的重开操作；真实文件的故障注入测试无需挂载共享即可复现失败。

预备流 API 还承诺在调用回调前刷新临时文件。仅等待写流的结束回调，不等于等待描述符关闭或 Node 在关闭时执行的刷新。

## Decision

在持有已打开描述符的写入器处恢复既有的交付前刷新约定。内存数据预备操作在关闭前刷新原始写句柄。流预备操作使用 Node 的 `createWriteStream({ flush: true })`，通过 `finished()` 等待包括关闭在内的完成状态，再交付预备字节。提交读取预备路径的状态并重命名，不再重新打开。流取消清理等待真正关闭，包括尚未结束的刷新，而不是把 `destroyed` 当作描述符已关闭的证明。

不会忽略任何同步错误。文件刷新失败仍会拒绝操作、保留原目标并清理临时输出。同目录临时位置、重命名发布、创建权限、哈希、元数据所有权及尽力而为的目录刷新保持不变。这不是降低保障的网络文件系统持久性模式。

## Alternatives considered

- 跳过 fsync 或直接写入最终备份：拒绝，因为前者可能削弱既有持久性约定，后者可能在失败时破坏旧备份。
- 以只读方式重试打开：拒绝，因为它仍要求重新打开已完成对象，也没有处理预备流的交付顺序。
- 为流自定义描述符刷新：无须如此；[Node 文件系统 API](https://nodejs.org/api/fs.html) 在受支持的运行时提供关闭时的 `flush` 选项。

## Consequences

预备操作现在在调用方收到预备字节前完成文件刷新，包括随后选择取消而非提交的调用方。这符合既有预备流承诺。不受支持的文件刷新操作仍会失败，不会默默接受可能不安全的备份。

这些测试没有验证真实 GVfs/SMB 或打包 Electron 验收。本修复不增加目标目录设置预检或新 UI 警告，也不证明所有文件系统均支持重命名或 fsync。在这个环境边界及更广的设置预检请求仍存在时，仅引用 issue #25004，不宣称其已解决。

## Verification

- Regression — `fs.atomic-durability.test.ts`：在注入 `r+` ENOTSUP 限制时，真实缓冲区和流字节替换已有目标且不留临时残余；文件刷新 EIO/ENOTSUP 保留旧目标；延迟刷新阻止提前发布，取消等待关闭。
- Regression — `fs.test.ts` 和 `fs.errno-warn.test.ts`：既有预备写入、权限、哈希、条件写入、复制、下载、取消、重命名失败及错误可观测性测试通过。
- Regression — `LegacyBackupManager.test.ts`、`sentryLog.test.ts`、`FileManager.integration.test.ts`、`FileManager.ipc-v2.test.ts`、`FileEditService.test.ts` 和 `BootConfigService.test.ts`：受影响调用方的限定范围测试通过，不是真实网络共享或打包应用运行。
