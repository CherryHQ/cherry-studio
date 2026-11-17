---
description: 原生文件观察的归属、失效订阅、目录租约和 renderer 恢复
sources:
  - src/main/services/file/observation
  - src/main/ipc/handlers/fileObservation.ts
  - src/shared/ipc/schemas/fileObservation.ts
  - src/renderer/services/fileObservation
  - src/renderer/hooks/useFileObservation.ts
---

# 文件观察

[English](file-observation.md) | 中文

## 所有权

Main `FileObservationService` 是 `WhenReady` 生命周期服务，依赖 `WindowManager` 和 `PowerService`，持有原生 scope 与文件订阅。私有 `WatchScope` 封装现有 chokidar 适配器及就绪 Promise。目录 builder 显式接收服务并消费租约；释放投影时只释放其租约。

相同 scope key 共享原生资源。树的 key 包含根路径、深度与过滤策略；只影响投影的扩展名和 stats 选项不需要独立原生 scope。显式文件的 key 包含请求文件及用于监听的现存父目录。文件 scope 剪除无关路径，并观察父子关系，使替换、删除和重建仍可见。解析后的目标与符号链接绑定使用独立 scope；绑定变化使覆盖失效并要求重新绑定。原生监听就绪后再次解析绑定，避免把建立期间已经改向的旧覆盖视为有效。首次发现绑定本身不表示改向。新目录扫描会包含已经创建的目标项，覆盖目录和文件在同一批操作中创建的情况。它们不继承树对隐藏文件或 gitignore 的排除。共享不会把观察扩大到整个未使用工作区。

最后一个租约释放后关闭 scope。窗口销毁时释放该窗口的文件订阅；目录消费者有各自的清理。服务退出时停止接收新请求，并等待原生资源关闭。观察不持有文件字节、草稿、持久化记录或写入租约。

## 文件协议

shared schema 拥有全部传输类型。IPC 适配器要求受管发送方，通过 `FileManager` 解析 entry 句柄；path 句柄使用现有绝对路径契约。

| 路由或事件 | 契约 |
|---|---|
| `file.observe.open` | 获取就绪的观察覆盖，返回订阅 ID、基线修订号与覆盖状态；不读取内容 |
| `file.observe.activate` | 安装监听器后激活所属基线；回放交接期间合并的失效通知 |
| `file.observe.changed` | 定向失效通知，包含订阅 ID、最新修订号与 `live`、`stale` 或 `unavailable` 覆盖状态 |
| `file.observe.close` | 幂等释放所属订阅；其他窗口不能释放它 |

修订号表示单个订阅内的失效顺序，不表示文件系统写入顺序。缓冲的失效可以合并，因此修订号跳跃要求重新验证，不能用来回放假定存在的变更日志。通知不携带一致字节，也不确认保存。现有读取和条件写入路由仍是权威。

## Renderer 消费者

窗口内的 `fileObservationService` 注册表为完全相同的句柄共享一个 `FileObservationSession`。React 使用 `useFileObservation`；编辑会话直接订阅。不同编辑所有者的草稿和撤销仍然独立，即使共享观察。

统一的 `FilePreview` 宿主先获取观察，再读取元数据和内容。失效通知改变 source 代次，包括等长写入及元数据不变的情况。现有插件／source 取消机制拒绝过期读取和选择结果；已经发出的 IPC 不能被物理中止。插件保留兼容的阅读状态，不自行创建 watcher。

Renderer 订阅保留十秒空闲宽限期。释放后返回会建立新的观察覆盖。窗口聚焦和文档变为可见时，使活跃内容失效，或重试不可用的观察。已脱离的草稿在保存结束后，经过自身的有界宽限期释放订阅，同时保留草稿恢复；条件保存仍验证基线。

## 失败与恢复

首次建立可能失败；`unavailable` 与文件缺失或空内容不同。watcher 错误使覆盖失效，系统恢复把活跃 scope 标为 stale。目录 builder 在释放前发布状态变更，目录会话重新获取快照。文件会话释放过期订阅并重连，最多尝试三次激活。获取失败或激活重试耗尽后，保留显式错误，可在窗口聚焦／文档变为可见时重试。

Live coverage 表示观察链路活跃，不表示消费者已经完成最新读取。文件消费者根据观察版本以及本地草稿／读取代次保护读取。保证以收到失效通知或显式恢复触发、且重新读取成功为前提。系统没有周期性的完整工作区扫描，不提供无损文件系统日志，也不对操作系统无声漏事件承诺固定刷新时延。
