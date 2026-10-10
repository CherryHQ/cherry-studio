---
description: 沙盒原生三平台后端候选机制、Windows 选型与验证门槛，以及排除 WSL2 的决策
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

已确认实现原生 macOS、Windows、Linux 后端。2026-09-25 决定不实现 WSL2，避免硬件虚拟化前置条件，原因见第 4 节。Windows 首次初始化允许管理员授权，日常运行不反复提权；原生机制仍待选型。

## 1. 候选路线

Cherry 统一管理策略、授权、生命周期与业务 RPC，各平台后端落实操作系统限制。需同时验证用户资源保护和不同信任组之间的隔离。

| 平台 | 候选机制 | 决定性门槛 |
| --- | --- | --- |
| macOS | Seatbelt | 运行时与系统服务的必要例外、进程树收敛、签名打包后的权限边界 |
| Linux | bubblewrap + namespaces + seccomp | 发行版安全策略、组件分发、命名空间与配额权限、父进程死亡后的清理 |
| Windows | 按信任组隔离身份与受限进程，或 AppContainer | 原生运行时兼容、多实例隔离、首次初始化后普通用户完成日常生命周期 |

Cherry 定义自己的后端契约，按平台验证隔离机制与可复用的基础组件；其他 Agent / Harness 的实现仅作为设计参考，不直接确定为通用沙盒底座。不自动降级到更弱后端或普通进程。

## 2. 原生后端的共同要求

macOS 以 Seatbelt 为候选；Linux 以 bubblewrap、namespaces 和 seccomp 的组合作为候选。具体策略生成、辅助程序、分发方式与兼容范围尚未定案，不能把某个工具可启动当作完成隔离。

需重点验证以下边界：

- **读取策略**：仅开放运行时必要文件、插件代码与授权数据，保护宿主凭据和数据库；按平台列出必须额外开放的系统资源。
- **多实例权限**：验证 A 获准的目录和代理对 B 不可用；独立管理进程只能隔离管理状态，不能据此证明 OS 权限独立，需同时检查账户、ACL、句柄和通道。
- **网络**：默认关闭，按需通过受控代理或宿主能力访问；测试直接连接、DNS、IPv6、回环和局域网，不能将阻止直接 TCP 连接等同于阻止所有网络外传。
- **RPC 通道**：验证 Unix domain socket 的访问约束，或预先建立的专用连接、继承管道；不得为了 RPC 直接放开所有本地 socket。
- **部署与清理**：验证 Linux 所需组件与用户命名空间条件、Windows 普通用户日常运行、进程树退出和权限残留回收。

### 2.1 系统服务与资源验证矩阵

以下是原型必须覆盖的入口清单，不是已确认的 Cherry 漏洞或已完成的防护。后端负责直接访问和 OS 服务入口，宿主能力实现负责经 Cherry 代办的效果；可信组件的职责见[设计草案](./design.md#2-最小分层)。必要例外必须限定对象与操作，并列入有效策略的 runtimeAccess，不能以整类服务放行为默认值。

| 平台 / 受保护资源 | 潜在访问入口 | 候选限制机制 | 必要例外 | 拒绝项与成功对照 | 当前证据 |
| --- | --- | --- | --- | --- | --- |
| macOS 凭据与隐私权限 | Keychain、安全服务、TCC 归属及 Mach/XPC 服务 | Seatbelt 默认拒绝、逐项服务限制；评估独立运行时身份和 disclaim | 经验证的运行时系统服务，不默认继承 Cherry 权限 | 测试凭据与隐私资源不可读，Node/Python 正常启动 | Electron 已说明 disclaim 的归属语义；Cherry 打包运行时待测 |
| macOS 桌面与代启动 | 剪贴板、窗口服务、Apple Events、LaunchServices | 限制服务查询、事件发送和代启动入口 | 首版无桌面业务例外 | 拒绝读取测试剪贴板或请求沙盒外启动；授权内子进程可运行并回收 | 具体策略与路径均待测 |
| macOS 同 UID 进程控制 | 向宿主或其他实例发送信号、查询受限进程信息、获取 task port | 以默认拒绝策略验证 Seatbelt 的 signal、process-info*、mach-priv-task-port 等规则及目标范围 | 仅经验证的实例内必要操作，不因同 UID 放行 | 对专用同 UID 测试进程的越界信号、受限信息查询及 task port 获取被拒绝；实例内获准操作成功 | 待测；需实际观察效果，不能仅凭 allow-default 下添加 deny 规则判定有效 |
| macOS 网络与本地通道 | IP 连接、系统 DNS、本地 resolver socket | 同时限制网络和解析入口，只开放实例专用通道 | 所选 RPC 通道和受控代理 | deny 下 DNS/直接连接失败；RPC 成功且不能访问其他 socket | 待测，不能以 TCP 拒绝替代 DNS 证据 |
| Linux 桌面、身份与代启动 | D-Bus、X11/Wayland、抽象 Unix socket、宿主进程及继承 FD | 文件/网络/PID 命名空间、能力移除、FD 白名单及 seccomp | 运行时必要挂载和专用通道；不整体挂载用户运行目录 | 拒绝会话服务代启动、桌面访问及宿主进程操作；授权内 I/O 与子进程成功 | bubblewrap 官方警告 D-Bus 可导致沙盒外执行；Cherry 待测 |
| Linux 网络与子进程收敛 | 共享 netns、网络系统调用（含 io_uring 路径）、后台进程 | 验证网络隔离与系统调用过滤组合、PID 命名空间及父进程死亡处理 | 按 deny/proxy/unrestricted 分别验证；网络放开不隐含开放桌面 IPC | 检查绕开代理的访问、抽象 socket 及父进程死亡后存活任务；允许目标连接成功 | 具体机制组合待测 |
| Windows 凭据、桌面与系统代办 | DPAPI、窗口/剪贴板、COM/DCOM、WMI、任务计划程序 | 受限令牌或 AppContainer/LPAC；评估私有 desktop/window station、Job UI 限制及服务访问控制 | 逐项证明运行时所需权限；不默认继承交互桌面 | 测试凭据、桌面与沙盒外代启动不可用；解释器和授权内子进程正常 | 微软建议受限进程使用其他 desktop；其余组合待测 |
| Windows 通道与网络路径 | named pipe 抢占/跨实例连接、UNC 解析及认证、直接联网 | pipe ACL、认证、首次创建检查；远程路径预先拒绝；独立网络限制 | 指定实例 pipe 和明确授权目标 | 拒绝伪造服务端、跨实例连接及未授权 UNC；合法握手/目标成功 | 待测 |
| 三平台宿主文件代办 | 目标可写目录中的链接、重解析点、目录替换，以及 ACL/清理入口 | [宿主文件规则](./design.md#51-宿主代办操作与输出边界)；必要时不开放该操作 | 明确授权的对象和操作 | 路径替换不能影响授权外文件，正常读写/清理成功 | 待测，启动时路径校验不构成证据 |
| 三平台资源消耗 | fork、内存分配、持续写盘 | 按环境验证进程树配额；Linux 评估可委派的 cgroup v2 | 未要求的配额明确不提供 | 声明配额时真实滥用被限制，预算内任务成功；无配额时不承诺主机可用性 | API 已排除 CPU/磁盘硬配额，内存/进程数能力待测 |

资料依据：[Electron disclaim](https://www.electronjs.org/docs/latest/api/utility-process)、[bubblewrap 安全限制](https://github.com/containers/bubblewrap#limitations)、[Windows 受限令牌](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens)、[Linux cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)。这些资料支持验证方向，不代表候选机制单独足够。评论中报告的本地实测未由本项目复现，证据表不得标为已通过。

进程分离只提供有条件的故障隔离；未落实资源配额时，独立进程仍可争用并耗尽主机资源。按用户计数的限额不能直接当作按实例配额；也不能因某平台缺少一种机制就预先断言所有后端均不可限制。

## 3. Windows 原生后端

以下是原生后端的两个候选方向，尚未决定具体组合或基础组件：

| 方向 | 研究重点 | 尚未解决的问题 |
| --- | --- | --- |
| 专用身份与受限进程 | 评估按信任组隔离身份、受限令牌、NTFS ACL、WFP 网络规则和 Job Object 的组合 | 身份的创建与回收、多实例并发，以及首次初始化后新建实例无需反复提权的机制 |
| AppContainer | 利用文件、网络、进程与凭据隔离 | Node/Python、原生模块、文件授权、named pipe 和生命周期兼容性 |

Codex elevated 后端使用低权限专用用户、文件权限、防火墙及本地策略，可作为参考；其较弱的 unelevated 模式不能直接成为插件安全要求的降级路径。Codex 的机制也不自动证明满足 Cherry 多插件隔离需求。[Codex Windows 文档](https://learn.chatgpt.com/docs/windows/windows-sandbox)

AppContainer 提供多种资源隔离，但不能仅凭平台能力宣称插件宿主可以直接运行；须通过实际运行时与 IPC 验证。[微软 AppContainer 说明](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)

### 3.1 初始化与特权组件的未决选择

已确认的是一次管理员初始化和日常不反复弹出 UAC，主进程与目标保持普通或受限权限。是否允许初始化安装持续运行的特权服务或开机任务尚未决定，不能把它隐含在“专用账户”方案中。

| 选项 | 必须证明的条件 | 额外成本或限制 |
| --- | --- | --- |
| 初始化后不保留特权组件 | 普通权限完成实例创建、身份隔离、规则建立与回收，跨系统重启仍有效 | 不满足任一条件则该路线不可用，不能复用身份来静默削弱隔离 |
| 安装最小特权服务或开机任务 | 明确哪些动作必须提权；仅可信主进程能请求固定、受约束的管理操作 | 新增高权限攻击面、签名更新、崩溃恢复及卸载责任；需单独决策 |

若采用特权组件，应限制其职责到已证明必需的身份/规则管理，不提供任意命令、任意路径 ACL 修改或普通业务 RPC。服务须认证调用者并验证对象归属、参数与路径安全；开机任务须保护配置和可执行文件免遭普通用户替换。故障、升级或重启期间不能放行未完成限制的实例；不将目标提供的数据直接作为特权操作参数。

Microsoft MXC 的 host-prep 文档记录了其 AppContainer 运行方案的系统盘 ACL 准备及每次系统启动后从提权上下文准备 Null 设备的要求。这是实际兼容性验证项，不是所有 AppContainer 启动方式必然需要相同修改的结论。原型需验证选定 Node/Python、标准流方式和 Windows 版本；不能靠日常请求 UAC 补救。[MXC host preparation](https://github.com/microsoft/mxc/blob/main/docs/host-prep.md)

账户数量、账户池或 AppContainer SID 均不能直接作为跨信任组隔离证明；系统目录的必要读取例外也需列明。必须测试真实的文件、凭据、通道及网络访问，再确定原生路线是否满足要求，不能从单个方案的限制推断整个 Windows 目标不可行。

## 4. 已排除：WSL2

2026-09-25 决策：不实现 WSL2 后端。WSL2 依赖硬件虚拟化和 Windows 的 Virtual Machine Platform 组件；本项目不接受将其作为启用沙盒的前置条件。[微软 WSL 文档](https://learn.microsoft.com/en-us/windows/wsl/faq#does-wsl-2-use-hyper-v)

不实现发行版安装维护、跨系统路径映射或 `wsl.exe` 桥接，也不将 WSL2 保留为原生 Windows 失败后的备用路线。包结构与 API 只包含原生三平台；Windows 原生机制不能满足策略时明确报告不可用，不能以普通进程代替。

## 5. 选型验证门槛

所有路线均需验证：允许访问成功、越界读写与网络访问被拒绝、不同信任组不串权、双向 RPC 正常、断连结束等待、退出无残留执行；同一信任组共享进程的边界保持不变。

各平台需以两个实例分别授权不同目录及网络目标，验证互相不可借用；指定 RPC 通道可用且其他宿主通道不可达。Windows 还需验证一次初始化后，普通用户跨应用及系统重启创建、停止和清理实例不反复提权。

### 5.1 Linux 部署与支持矩阵

以下是首轮测试环境分类，尚不是已支持版本列表。记录 OS/内核、AppArmor 等安全模块配置、架构、打包形式、bwrap 来源与版本、命名空间及 cgroup 权限；发行支持范围由这些证据决定。

| 环境 | 要验证的条件 | 条件不满足时 |
| --- | --- | --- |
| 启用 user namespace 限制的 Ubuntu（包括 24.04 LTS） | 实际 launcher/bwrap 路径是否有适用的 AppArmor 授权，能否完成全部隔离建立 | 报告所需安装配置；不能仅因 unshare 成功就 ready |
| AppImage 内置组件与发行版系统组件 | 分别验证实际运行路径、策略匹配和更新后的可用性 | 不假设系统 bwrap 的授权会自动覆盖随包程序 |
| 禁用 user namespace 或 cgroup 委派的受管环境 | 必需隔离和已要求的配额是否可建立 | 返回 setup-required 或 unavailable；无获准修复路径则拒绝启动 |

Ubuntu 官方说明其限制可能允许创建 user namespace，却拒绝随后在其中使用 capabilities，因此探测必须覆盖完整后端启动流程。[Ubuntu 24.04 说明](https://documentation.ubuntu.com/release-notes/24.04/#unprivileged-user-namespace-restrictions)

安装系统组件或策略属于独立维护流程，不在启动时自动执行；不能自动关闭系统安全设置，也不能因发行版常见就降级到普通进程或不满足 spec 的弱隔离。生产版本矩阵在打包原型通过后冻结。
