---
description: 沙盒后端候选方案，比较原生三平台、Windows 独立后端和 WSL2 路线及其验证门槛
status: draft
date: 2026-09-24
sources:
  - src/main/core/utilityProcess/host/processAdapter.ts
  - src/main/core/utilityProcess/host/electronProcessAdapter.ts
  - src/main/ai/runtime/dsh/DshBridgeServer.ts
---

# Sandbox Backend Options

本文记录 [proposal](./proposal.md) 与[设计草案](./design.md)讨论中的后端候选。资料核对日期为 2026-09-24；尚未选定生产依赖，未执行安装、原型或三平台验收。

各路线需要兑现相同的 [API 草案](./api.md#6-平台后端契约)；API 中声明的限制是后端验收要求，不表示这些机制已经在所有平台实现。

原生 macOS、Windows、Linux 仍是已记录的目标。WSL2 已纳入比较，但尚未决定用它替代首版原生 Windows 支持；若选择替代，需明确调整平台要求。Windows 首次初始化允许管理员授权，日常运行不反复提权。

## 1. 候选路线

Cherry 统一管理策略、授权、生命周期与业务 RPC，各平台后端落实操作系统限制。需同时验证用户资源保护和不同信任组之间的隔离。

| 路线 | macOS / Linux | Windows | 收益 | 成本与决定性门槛 |
| --- | --- | --- | --- | --- |
| A：三平台原生后端 | 评估 Seatbelt / bubblewrap + namespaces + seccomp | 评估按信任组隔离身份或 AppContainer | 保持各平台原生运行时和工具兼容 | 原生辅助程序、安装与安全维护成本；需证明权限、RPC 与清理符合要求 |
| B：Windows 使用 WSL2 | 同路线 A | Cherry 专用 WSL2 发行版内运行 Linux 沙盒 | Windows 与 Linux 复用更多实现 | 首次安装、可能重启、发行版维护、Linux 原生依赖和跨系统文件访问；不等于原生 Windows 后端 |

Cherry 定义自己的后端契约，按平台验证隔离机制与可复用的基础组件；其他 Agent / Harness 的实现仅作为设计参考，不直接确定为通用沙盒底座。Windows 保留原生与 WSL2 两条路线比较；不自动降级到更弱后端或普通进程。

## 2. 原生后端的共同要求

macOS 以 Seatbelt 为候选；Linux 以 bubblewrap、namespaces 和 seccomp 的组合作为候选。具体策略生成、辅助程序、分发方式与兼容范围尚未定案，不能把某个工具可启动当作完成隔离。

需重点验证以下边界：

- **读取策略**：仅开放运行时必要文件、插件代码与授权数据，保护宿主凭据和数据库；按平台列出必须额外开放的系统资源。
- **多实例权限**：验证 A 获准的目录和代理对 B 不可用；独立管理进程只能隔离管理状态，不能据此证明 OS 权限独立，需同时检查账户、ACL、句柄和通道。
- **网络**：默认关闭，按需通过受控代理或宿主能力访问；测试直接连接、DNS、IPv6、回环和局域网，不能将阻止直接 TCP 连接等同于阻止所有网络外传。
- **RPC 通道**：验证 Unix domain socket 的访问约束，或预先建立的专用连接、继承管道；不得为了 RPC 直接放开所有本地 socket。
- **部署与清理**：验证 Linux 所需组件与用户命名空间条件、Windows 普通用户日常运行、进程树退出和权限残留回收。

## 3. 路线 A 的 Windows 原生后端

以下是原生后端的两个候选方向，尚未决定具体组合或基础组件：

| 方向 | 研究重点 | 尚未解决的问题 |
| --- | --- | --- |
| 专用身份与受限进程 | 评估按信任组隔离身份、受限令牌、NTFS ACL、WFP 网络规则和 Job Object 的组合 | 身份的创建与回收、多实例并发，以及首次初始化后新建实例无需反复提权的机制 |
| AppContainer | 利用文件、网络、进程与凭据隔离 | Node/Python、原生模块、文件授权、named pipe 和生命周期兼容性 |

Codex elevated 后端使用低权限专用用户、文件权限、防火墙及本地策略，可作为参考；其较弱的 unelevated 模式不能直接成为插件安全要求的降级路径。Codex 的机制也不自动证明满足 Cherry 多插件隔离需求。[Codex Windows 文档](https://learn.chatgpt.com/docs/windows/windows-sandbox)

AppContainer 提供多种资源隔离，但不能仅凭平台能力宣称插件宿主可以直接运行；须通过实际运行时与 IPC 验证。[微软 AppContainer 说明](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)

## 4. 路线 B：WSL2 内运行 Linux 沙盒

建议结构如下，具体桥接尚未验证：

```text
Cherry 主进程（Windows）
    ⇅ 双向 RPC，经 wsl.exe 标准流桥接
可信启动与通信组件（Cherry 专用 WSL2 发行版）
    ↓ Linux 沙盒后端
受限 Linux Node / Python 进程
```

WSL2 提供执行环境，发行版内部仍按实例建立文件、网络和进程限制。专用发行版不是插件之间的隔离边界。微软支持通过 `wsl.exe` 管道传输数据；长驻双向协议、背压、取消和异常退出需另行验证。协议流与日志分开，业务协议保持 RPC over 本地 IPC。[跨系统管道](https://learn.microsoft.com/en-us/windows/wsl/filesystems)

环境设计建议：

- 使用 Cherry 管理的专用发行版，不修改用户已有发行版或全局 `.wslconfig`。
- 关闭 Windows 磁盘自动挂载、Windows 程序互操作和 Windows PATH 注入；同时检查其他挂载入口。仅关闭自动挂载不能阻止手动挂载。
- 插件使用非 root 身份，不能修改隔离配置、访问可信管理组件或自行挂载宿主资源；Linux 沙盒仅开放获准路径和通信通道。
- 插件代码和运行时优先放在 Linux 文件系统；Windows 工作区通过显式授权映射或宿主 API 提供。映射路径、链接、大小写及文件监听语义需要验收。
- Windows 原生能力经授权 RPC 调用宿主；插件使用 Linux 版 Node/Python 及原生依赖，不承诺 Windows 二进制兼容。

WSL 默认自动挂载固定磁盘并启用 Windows 程序互操作，以上设置需要显式管理。标准安装流程要求管理员权限并可能重启；日常免提权仍是 Cherry 的验收要求。[WSL 配置](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)、[安装要求](https://learn.microsoft.com/en-us/windows/wsl/install)

额外成本包括发行版下载与更新、磁盘占用、启动与内存开销，以及跨系统文件访问。微软建议 Linux 工具将文件存放在 Linux 文件系统以改善性能；Cherry 尚无实测数据。[文件存放建议](https://learn.microsoft.com/en-us/windows/wsl/filesystems#file-storage-and-performance-across-file-systems)

生命周期须同时覆盖 Windows 启动进程和 Linux 目标进程树，不能认为 `wsl.exe` 退出就代表清理完成；不能通过全局 `wsl --shutdown` 清理单个插件并影响用户其他发行版。

## 5. 选型验证门槛

所有路线均需验证：允许访问成功、越界读写与网络访问被拒绝、不同信任组不串权、双向 RPC 正常、断连结束等待、退出无残留执行；同一信任组共享进程的边界保持不变。

| 路线 | 额外证据 |
| --- | --- |
| A | 各平台两实例分别授权不同目录及网络目标后互相不可借用；指定 RPC 通道可用且其他宿主通道不可达；Windows 初始化后新建、停止和清理实例不反复提权 |
| B | 满足 Linux 后端隔离要求；禁止 Windows 程序互操作及未授权磁盘访问；Windows 工作区授权有效；桥接或宿主异常退出后 Linux 进程树被清理；不影响其他发行版 |

选型前需决定 WSL2 是可选后端还是首版 Windows 主路径。如果选择后者，应同步修改原生 Windows 要求，明确最低系统与 WSL 版本、安装与重启体验、发行版交付维护方式及运行时兼容范围。
