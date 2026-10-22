---
description: 文件编辑会话的归属、条件持久化、观察租约和保留草稿恢复
sources:
  - src/main/services/file/FileEditService.ts
  - src/main/services/file/FileObservationManager.ts
  - src/renderer/services/fileEdit
  - src/renderer/hooks/useFileEditSession.ts
  - src/renderer/components/FileEditSessionProvider.tsx
  - src/shared/ipc/schemas/fileEdit.ts
  - src/shared/ipc/schemas/fileObservation.ts
---

# 文件编辑会话

[English](file-editing.md) | 中文

## 归属

`FileEditSessionProvider` 在主窗口和子窗口的组合根中创建由窗口持有的 `FileEditSessionManager`。`useFileEditSession` 获取租约并通过 `useSyncExternalStore` 订阅；它不持有草稿、保存定时器或 SWR 缓存。笔记、Skill 文件和产物编辑使用同一个会话边界。

| 归属方 | 职责 |
|---|---|
| Renderer 管理器 | 规范资源注册表、草稿和磁盘基线、修订号、写入附件、保存队列、替换与变更操作的输入封闭、保留草稿清单 |
| 编辑器 | 交互文档和撤销历史；回调携带所属附件和文档代次 |
| `FileEditService` | 窗口所属的编辑租约、固定的 entry/path 目标、不可变写入尝试和终态回执 |
| `FileObservationManager` | 共享 watcher 覆盖范围和窗口范围内的观察订阅 |
| `DirectoryTreeManager` | 共享树构建器和 Renderer 树投影；独立于编辑会话释放自己的 watcher 租约 |

解析到同一受许可规范地址的 path 和 entry 共享一个 Renderer 会话。每个定位句柄在 Main 中仍有独立租约。已接受的编辑保留其来源句柄，因此共享草稿不会把 entry 目标校验变成 path 写入。只有一个附件可写，其他附件观察只读快照。不承诺合并符号链接和硬链接别名。

## 持久化契约

| 路由 | 契约 |
|---|---|
| `file.edit.open` | 解析句柄、执行路径策略，返回固定的编辑 ID、规范资源键和观察根目录 |
| `file.edit.read` | 返回有大小限制的一致二进制快照，以及这些确切字节的哈希 |
| `file.edit.write` | 提交不可变字节、必需的预期版本/哈希以及租约内序号 |
| `file.edit.settle_write` | 恢复终态回执；阻止尚未开始的同序号请求迟到执行 |
| `file.edit.close` | 停止接收请求，等待已接受的读写结束，然后释放租约和临时条目保留引用 |

8 MiB 限制在加载前及加载过程中执行。已经打开的编辑器可以增长至超过该限制。编解码器保留 UTF-8 BOM 和 LF/CRLF，拒绝不支持的编码或混合换行。打开文件或切换编辑模式不会把未经编辑的富文本文档重新序列化到磁盘。

写入返回 `committed`、`not-committed` 或 `not-started`。已提交回执包含新基线和 `metadataRecoveryPending`；元数据收尾失败不得重放已提交的字节。传输丢失回执时，Renderer 必须先确认同一序号的结果，再发起下一次写入。结果仍未知时保留写入尝试和草稿。

`flush()` 在调用时立即捕获当前草稿和修订号。该目标排在旧写入之后，不能被后续编辑替换。特别是，另一份内容仍在保存时撤销回上一份磁盘文本，也必须执行后续写入。自动保存对尚未发送的编辑做防抖。持续失败会暂停自动重试，同时保留编辑和显式重试能力。

Entry 写入、entry 重命名/删除/清理和 path 变更按 entry 锁 → path 互斥锁的顺序协调。只要提供哈希就执行哈希校验，包括大小相同且保留亚秒级时间戳的情况。原子替换不提供针对任意外部程序在校验与 rename 之间写入的 compare-and-swap 保证。

## 替换和变更操作

`documentEpoch` 在初始文档或显式替换时变化，普通编辑和保存回执不改变它。笔记按会话/epoch 挂载编辑器，删除了原先通过字符串比较来回填正文的 effect。程序触发的富文本回填不产生编辑回调。非活动页签恢复时，依赖编辑器的 UI 会等待 Tiptap 实例就绪。独立的绑定代次会拒绝封闭输入/取消期间捕获的旧回调，同时保留当前文档和撤销历史。

`discard()` 等待写入结束并恢复已确认的基线。`reload()` 等待写入结束后才接纳新的磁盘文档。`keepLocal()` 封闭输入、捕获草稿、读取新基线，再条件保存捕获的文本。失败时草稿仍可用。

`prepareMutation(roots)` 封闭匹配的会话并保存已接受的编辑。变更操作在窗口内串行执行，暂时阻止新的附件，并使准备之前启动的获取请求失效。调用方执行文件系统操作后，调用 `commit()` 结束已删除资源的会话，或调用 `commit({ from, to })` 校验并绑定移动后的资源。操作失败时用 `cancel()` 恢复输入。移动后校验失败会保留源快照及错误；它不能撤销已完成的文件系统移动。笔记的重命名、移动和删除通过此边界执行，包括目录操作。

## 文件观察

`file.observe.create` 等待 watcher 就绪，并将事件缓冲至 `file.observe.activate`。ID、代次、所属窗口、序号和有界队列保护这个握手过程。`file.observe.dispose` 释放一个订阅；最后一个租约关闭原生 watcher。相同的根目录、选项和过滤策略可以与树构建器共享覆盖范围。

Renderer 独立于可见目录树观察父目录。事件只使已有认知失效，不携带替换草稿。会话重新读取文件，并在接纳结果前检查读取代次、修订号、待完成写入和输入封闭状态。保存或输入封闭期间延后的通知，会在会话恢复可用时重新校验。脏内容保留在内存中，冲突字节会暂停保存。事件缺口、队列溢出和 watcher 错误触发带有有界退避的重新订阅与校验。编辑事件不会仅凭修改时间就被当作自身保存回声而忽略。

## 关闭和恢复

关闭文件视图会释放其附件，并在 Renderer 仍存活时尝试保存已接受的编辑。窗口关闭、应用退出、重新启动、Renderer 重载和窗口池重置保持原有生命周期行为；这些操作没有文件编辑准备屏障，不保证保留尚未落盘的内存草稿。

Main 在所属窗口销毁或服务停止时释放编辑租约和观察订阅，并等待已经接受的文件操作结束。此类清理无法保存尚未到达 Main 的编辑。Renderer 重载本身不保证释放上一份页面持有的全部租约。

释放视图不会丢弃脏、失败、冲突或结果未知的会话。窗口恢复界面列出已脱离视图的草稿，并提供复制/重试/丢弃操作。干净且操作已结束的会话在所有附件离开后释放观察订阅和 Main 租约。这是在进程内保留草稿，不是崩溃恢复日志或协作历史。

## 验证边界

服务测试覆盖真实文件系统哈希、别名竞争、重命名、租约归属、结果确认栅栏和元数据恢复。Renderer 测试覆盖文件切换、旧回调、固定的 flush 目标、保存中撤销、失败草稿保留、替换、变更操作封闭、组合输入否决和观察重连。各平台的 Electron 验收及更广泛的 CI 与这些本地契约测试分别记录。
