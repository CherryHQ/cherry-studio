---
description: 沙盒原生三平台后端候选机制、Windows 选型与验证门槛，以及排除 WSL2 的决策
status: draft
date: 2026-09-29
sources:
  - src/main/core/utilityProcess/host/processAdapter.ts
  - src/main/core/utilityProcess/host/electronProcessAdapter.ts
---

# Sandbox Backend Options

当前代码架构见 [Sandbox 当前架构](./architecture.md)：包含实际进程边界、MXC 适配、RPC 调用链及已实现范围。本文中的历史方案和后续目标不作为当前实现说明。

本文记录 [proposal](./proposal.md) 与[设计草案](./design.md)讨论中的后端候选。**2026-10-12 当前决定：demo 采用 MXC，优先跑通沙盒执行和双向 RPC。** 用户接受 macOS 硬链接、可写目录 Unix socket、脱离进程组后代回收差异；它们不再阻断本轮公开启动。当前实现和命令见 [MXC demo](../../packages/sandbox/README.md)。以下原型阻断记录及严格安全矩阵保留为历史研究，不代表当前 demo 的验收门槛；三平台及打包验收仍未完成。

本机通过 MXC CLI 和 Node SDK 验证了目录授权、原文件直接写入、IP loopback deny，以及 Node/Python 标准流回调。新版包复用发布版 `@microsoft/mxc-sdk@1.0.1`，在公共 `SandboxManager` 后增加 MXC 适配，双向 RPC 使用 `vscode-jsonrpc` 和 Content-Length。完成状态保留 `tree: unverified`，不把 SDK 释放当作完整后代回收证据。

2026-09-29 继续验证 macOS ACL、已有描述符与进程组终止，并补充 macOS 27 后代专用 Endpoint Security 接口的候选条件，见第 2.4 节。本机实验环境仍为 macOS 26.5，未改变最低系统要求或启用新后端。

各路线需要兑现相同的 [API 草案](./api.md#6-平台后端契约)；API 中声明的限制是后端验收要求，不表示这些机制已经在所有平台实现。

实现范围已确认为原生 macOS、Windows、Linux 后端。2026-09-25 决定不实现 WSL2，避免硬件虚拟化前置条件，原因见第 4 节。Windows 首次初始化允许管理员授权，日常运行不反复提权；原生机制仍待选型。

## 1. 候选路线

Cherry 统一管理策略、授权、生命周期与业务 RPC，各平台后端落实操作系统限制。需同时验证用户资源保护和不同信任组之间的隔离。

| 平台 | 候选机制 | 决定性门槛 |
| --- | --- | --- |
| macOS | Seatbelt；文件对象约束与进程树管理机制待验证 | 原目录直接读写时的硬链接与路径替换边界、进程树收敛、系统服务例外及签名打包 |
| Linux | bubblewrap + namespaces + seccomp | 发行版安全策略、组件分发、命名空间与配额权限、父进程死亡后的清理 |
| Windows | 按信任组隔离身份与受限进程，或 AppContainer | 原生运行时兼容、多实例隔离、首次初始化后普通用户完成日常生命周期 |

Cherry 自行设计并拥有实例管理、权限映射、双向 RPC、生命周期和后端契约；隔离原语、代理、原生 helper 与协议库按能力评估复用，不要求全部重写。API/RPC 形状不同本身不排除复用，权限语义、实例边界、必需保护失败和回收保证才是验收依据。尚未决定直接依赖某个 Agent / Harness 的完整管理器，也不自动降级到更弱后端或普通进程。

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

### 2.2 macOS 验收状态与阻断项

2026-09-25 在 macOS 26.5 arm64 的开发构建上核查。**macOS 尚未验收通过**；单进程后端实验、公开 API 可用性、签名打包验收是不同事实。下表记录当时自研单进程原型的实验结果；该原型、supervisor 和专用测试已于 2026-10-12 删除，当前 `pnpm test:sandbox` 验证 MXC 实现。下述旧启动阻断不适用于已接受差异的 MXC 范围。

| 契约项 | 当前证据 | 结论与剩余验证 |
| --- | --- | --- |
| 标准流、允许读写、退出状态 | bash/cat/true/curl 和自有 C fixture；stdin、非零退出、授权内 I/O 对照 | 局部通过；Node/Python、native modules 和跨架构尚未验证 |
| 文件对象隔离 | 已有硬链接及启动后由测试宿主加入的硬链接，都能绕过对源目录的显式 deny，读写外部 fixture | **不满足**；realpath 与根对象 nlink 校验不足，公开 API 阻断启动；尚未实现对象隔离修复 |
| 静态符号链接与显式 deny | 授权目录内符号链接指向外部时访问失败，较宽授权内 deny 生效，两实例目录不串权 | 静态和启动后加入的符号链接对照通过；将 denied 目录移动到允许路径后可读写原受保护文件，目录对象替换不满足契约；运行时/可执行文件替换仍待测 |
| 网络及本地通道 | 可信子进程检查 IPv4/IPv6 回环 connect、IPv4 UDP、一个 Unix socket 路径被拒绝 | **未知**；仍缺系统 DNS、局域网、其他本地入口及继承 Mach port 验证；连接失败不能替代完整禁网证据 |
| 系统服务 | 检查对 supervisor 的 signal/task port 访问被拒绝 | **未知**；Keychain、TCC、桌面、代启动服务及同 UID 其他实例入口仍待测 |
| 单目标退出及宿主崩溃 | fork/self-posix_spawn 被拒绝；强制停止、host SIGKILL、取消、lifetime、输出/输入预算用例通过 | 仅证明所测单进程路径；不涵盖 supervisor 丢失、整棵可 fork 进程树或全部资源耗尽路径 |
| 多进程树收敛 | 受限目标可成功 setsid，脱离原进程组；尚无防逃逸的实例成员集合 | **未实现**；processCount 大于 1 拒绝；不能以轮询 PID/进程组 kill 宣称满足 |
| ready 与失败契约 | 未验证项阻断公开 probe/start；硬链接攻击目标未执行；跳过 probe 同样拒绝；cleanup 失败后保留首次结果并可重试 | 阻断回归通过，不等于隔离后端验收通过；当前不创建动态 probe 进程，因此也不宣称完成动态能力检测 |
| RPC 与 Node/Python | 未实现 | 必须在隔离边界成立后分别验证原始标准流运行、嵌套双向调用与通道边界 |
| 分发与系统矩阵 | 仅本机未签名开发构建 | **未知**；签名、entitlements、Electron 包内运行、支持系统版本及 x64 都未验收 |

硬链接复现只操作测试自建目录：`allowed/alias` 与目录外 `secret` 指向同一个 inode，目标只有 `allowed` 的目录授权，却能通过 alias 修改 secret。不能通过启动前递归扫描 nlink 宣称解决，因为后续链接/路径替换仍可能改变授权对象。用户已确认保留直接读写原目录、即时影响原文件的语义，不采用隔离副本/显式回写。继续验证原生对象约束，不通过缩减这一要求解除阻断。

后续实验都只操作宿主自建 fixture，并在可信启动完成后用 stdin 握手控制访问时机；由测试宿主加入链接或替换目录，模拟并发修改，**不声称这些修改本身已能由受限目标发起**。四组结果如下：已有硬链接 + 源目录显式 deny、启动后加入硬链接 + 同一 deny、将 denied 目录移动到授权路径，均能读写原受保护对象；启动后加入符号链接则读写都被拒绝。前两项说明路径 deny 不自动覆盖另一硬链接名称，第三项说明路径授权未绑定原目录对象。

还验证了 Chromium 使用的原生 sandbox extension token：先为 allowed 目录发放 read-write token，再安装 default-deny 策略、只开放该 extension 并拒绝 blocked 目录；消费 token 成功后测试已有硬链接和目录替换，两者仍可读写原受保护 fixture。这个实验没有证明所有 extension 用法都无效，但排除了“把 subpath 换成目录 token 就修复”的方案。接口依据见 [Chromium extension 声明](https://github.com/chromium/chromium/blob/main/sandbox/mac/seatbelt_extension.h)与[实现](https://github.com/chromium/chromium/blob/main/sandbox/mac/seatbelt_extension.cc)；它使用 libsandbox 私有 API，本项目尚未采用为生产接口。

这些结果将后续研究范围收敛到：是否存在覆盖 open/link/rename 与已有句柄的原生对象授权机制，或独立身份与文件对象权限的组合。Endpoint Security 可作为待评估的事件授权机制，但 [Apple 要求专用 entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.endpoint-security.client)，传统 es_new_client 还要求 root 与 Full Disk Access；macOS 27 新增后代专用接口，权限与限制另见第 2.4 节。两者均未证明足以解决全部竞态。独立身份/ACL 亦未验证授权与回收，不能直接修改源文件权限或引入 macOS 特权 helper。现阶段不安装任何系统组件，不将这些候选写成已经选定的后端。

进程树方面，Apple 的 [event.h](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/event.h) 明确标记 NOTE_TRACK/NOTE_CHILD 自 10.5 起不再支持；[setsid 实现](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_prot.c)允许非组长创建新会话。本机受限目标也成功执行 setsid。由此排除“允许任意 fork 后，仅用 kqueue 自动跟踪或原进程组终止”的简单方案；这不等于证明所有 macOS 原生方案不可行。当时自研 supervisor 通过持有唯一子 PID 并 waitpid 回收实现单目标闭环，不能外推到后代集合。

实施顺序保持为：文件对象隔离与多进程收敛机制 → 完整网络/系统服务对抗矩阵 → Node/Python 及 RPC → 打包与支持系统矩阵。公开 backend 在这些必需项未满足时返回 unavailable；缺少 helper 时为 setup-required，构建 helper 本身不解除其他阻断。demo 只报告阻断并以非零状态退出，不增加跳过验收的参数。未来解除阻断还需恢复覆盖完整 spec、有界且保留资源归属的动态 probe，不能删除状态表中的未知项就直接放开执行。

### 2.3 sandbox-runtime 调研与复用边界

2026-09-25 核查完整源码：`@anthropic-ai/sandbox-runtime` 0.0.77，固定提交 [`ddbeb74711c4097014ef3056791efa83f553116c`](https://github.com/anthropics/sandbox-runtime/tree/ddbeb74711c4097014ef3056791efa83f553116c)。下述观察仅针对该版本；不是完整安全审计，也不表示已采用该依赖。

| 层次 / 平台 | 可参考或复用的实现 | 与 Cherry 契约的差距 |
| --- | --- | --- |
| 管理器与策略 | 初始化、配置 schema、依赖检查、代理管理 | 模块级共享 config/代理；单次 customConfig 不构成独立网络策略。POSIX argv 包装仍经过 shell，env/cwd 也需由可信宿主显式控制 |
| macOS | Seatbelt 策略、敏感路径保护、阻止搬移 read-denied 文件、运行时兼容例外 | 已有硬链接仍能访问被 deny 路径的同一对象；根退出不保证后代退出；系统服务例外尚不等同 Cherry 的 runtimeAccess |
| Linux | bwrap、namespaces、seccomp helper、代理桥接与 PID 回收 | seccomp helper 缺失时有告警继续路径；allowUnixSockets 路径白名单不适用 Linux，额外继承 FD 也非已验证的公共通道契约 |
| Windows | 专用账户、WFP、ACL 账本与恢复、restricted token、私有桌面和 Job | 安装账户可配置，但不是每实例独立身份池；共用 SID 的文件与对象权限不自动隔离。runner 自保护失败存在告警继续分支，ACL 清理也不能直接映射为 cleanup=complete |
| 代理与凭据 | HTTP/SOCKS 认证、域名和解析地址检查、可选凭据代注入 | 需启用 strictAllowlist；默认地址拒绝集不包含全部内网地址，上游代理解析不受本地 DNS 检查覆盖。代理 commandId 不能当作可信业务身份 |
| 生命周期与分发 | 平台 helper、部分终止机制及发布工作流 | 包装命令不是完整实例管理；整树配额、可信启动、结构化清理及 Electron 签名打包仍须验证 |

源码依据：[管理器](https://github.com/anthropics/sandbox-runtime/blob/ddbeb74711c4097014ef3056791efa83f553116c/src/sandbox/sandbox-manager.ts)、[配置语义](https://github.com/anthropics/sandbox-runtime/blob/ddbeb74711c4097014ef3056791efa83f553116c/src/sandbox/sandbox-config.ts)、[macOS](https://github.com/anthropics/sandbox-runtime/blob/ddbeb74711c4097014ef3056791efa83f553116c/src/sandbox/macos-sandbox-utils.ts)、[Linux](https://github.com/anthropics/sandbox-runtime/blob/ddbeb74711c4097014ef3056791efa83f553116c/src/sandbox/linux-sandbox-utils.ts)、[Windows helper](https://github.com/anthropics/sandbox-runtime/tree/ddbeb74711c4097014ef3056791efa83f553116c/vendor/srt-win-src)、[解析地址检查](https://github.com/anthropics/sandbox-runtime/blob/ddbeb74711c4097014ef3056791efa83f553116c/src/sandbox/resolved-address-guard.ts)。

文件策略不能按同名字段直接映射：上游通常默认允许读取再叠加 deny/carve-out，写授权还合并内置临时目录和设备例外。Cherry 必须验证默认拒绝、deny 优先和实际 runtimeAccess；不能把输入 allowWrite 原样作为有效策略。独立 controller 进程可以作为隔离上游全局状态的候选，但不能解决 Windows 共用 SID，也不能证明跨实例 OS 权限独立。

#### 本机实验与证据范围

在 macOS 26.5 (25F71) arm64、Node v24.11.1 上，将固定提交归档到独立研究目录，`npm ci --ignore-scripts` 和 `npm run build` 成功。实验只使用自建文件及本机 HTTP 测试服务，不修改链接仓库。这些是 **SRT 实验**，不属于第 2.2 节 Cherry backend 的验收结果。

| 实验设置 | 观察结果 | 能支持的结论 |
| --- | --- | --- |
| work 允许写，secret 同时 denyRead/denyWrite；启动前在 work 建立指向 secret/value 的硬链接与符号链接 | 原路径读写与符号链接读取受限；硬链接可读写，宿主读取原文件确认内容被修改 | 上游同样未满足我们的文件对象隔离要求；不能用更完整的 Seatbelt 规则宣称该阻断已解决 |
| 目标主动创建跨边界硬链接、将 secret/value rename 到 work | 均返回 EPERM；work 普通写入成功 | 这两条目标主动操作路径被拦截；不等同于已有别名或宿主并发修改场景 |
| Node、Python 分别通过标准流完成主请求20 → 回调宿主double → 返回41 | 均正常完成并退出0 | 双向通信不妨碍复用隔离层；仅使用 JSON 行探针，未验证 Cherry 的 Content-Length 协议、授权、取消或预算 |
| 根 Node 启动 detached 后代并退出，后代延迟写入 work 后自行退出 | 根退出后仍出现后代写入 | wrapper 根退出不是 tree=gone；没有证明后代脱离 Seatbelt |
| 全局允许本机测试地址，单次 customConfig 的 allowedDomains 为空 | 直连对照失败，经代理仍收到测试服务响应；随后全局 updateConfig 拒绝时代理返回阻止信息 | 单次配置不能被视为独立实例网络权限；不能只根据 curl 退出码判断代理是否允许访问 |

原始脚本和结果保存在调研工作区的 `.context/srt-research/probe.mjs` 与 `evidence.json`，未纳入版本库；上表保留复现配置和观察范围。后续要用这些结果解除任何阻断，必须先把对应探针纳入受维护的测试入口。此次没有在 SRT 上重做宿主并发替换目录实验，不能将 Cherry 旧原型的全部结果套用到上游。

固定提交的 [CI 运行](https://github.com/anthropics/sandbox-runtime/actions/runs/35592577978)在调研时有 8 个成功检查，覆盖三平台 x64/arm64 及两种架构的 Docker；本机没有执行其全量 Bun 测试。Linux CI 调整 user namespace/AppArmor 限制，Windows CI 采用管理员环境，不能据此证明普通用户桌面部署通过。Linux/Windows 本轮仅有源码及上游 CI 证据。

分发为 Apache-2.0、ESM，要求 Node >=20.11.0；Linux 需处理 bwrap/socat 等组件，Windows 需分发原生 helper。[发布工作流](https://github.com/anthropics/sandbox-runtime/blob/ddbeb74711c4097014ef3056791efa83f553116c/.github/workflows/release.yml)与 npm provenance 不能替代 Cherry 的 helper 路径、asar、平台签名和升级回收验收。凭据代注入、TLS 终止等可选功能暂不进入首个验证切片。

**采用结论**：保留自己的包和 API/RPC 契约，按平台验证底层复用；不直接以 SRT 单例替换 Cherry 管理者，也不先行决定维护完整 fork。自研同类规则不能自动修复原生机制的语义缺口，当前公开 backend 继续阻断。

### 2.4 macOS 原生机制可行性验证

2026-09-29 在 macOS 26.5 (25F71) arm64、Xcode macOS 26.5 SDK 上继续实验。此轮只操作自建临时文件、ACL 和进程，结束后移除测试 ACL 与临时目录；没有创建账户、修改用户源文件权限、安装服务或启用 ES 客户端。目标是筛选候选，**不是解除公开 backend 的阻断**。

#### ACL、已有描述符与进程树实验

| 最小实验 | 观察结果 | 对候选设计的约束 |
| --- | --- | --- |
| secret/value 与 work/alias 指向同一 inode，仅给 secret 目录加当前 UID 的读取/搜索 deny ACL | 原路径读写返回 EACCES，alias 仍可读写 | 目录 ACL 不能单独实现对文件对象所有别名的禁止 |
| 给 value 文件对象加当前 UID 的 read/write deny ACL，再从两条路径重新打开 | 两个名称均返回 EACCES；移除 ACL 后均恢复读写 | 文件 ACL 有对象级效果；但对同 UID 的可信宿主也生效，不能直接当作单实例权限 |
| work 配置仅向新文件继承的 deny ACL，对比新建文件、已有硬链接和后来添加的硬链接 | 新文件继承 deny，已有及后来添加的 alias 仍可读写原对象 | 目录 ACL 继承不等于对进入目录的已有对象重新授权；递归修改还需解决并发、归属及恢复 |
| 先打开 value 的读写 FD，再给文件添加 deny ACL | 新 open 被拒绝，已有 FD 的 pread/pwrite 仍成功 | 修改 ACL 不等于撤销已打开的访问能力；不能据此声明即时撤权 |
| 可信 fixture 先打开 value，再安装 deny-default Seatbelt 并显式 deny 该路径 | 新 open 返回 EPERM；已有 FD 仍能读取并修改原文件 | 限制建立前打开的能力必须由 launcher 清理，不能依赖加载 profile 自动撤销 |
| deny-default Seatbelt 仅增加 process-fork；根进程组内 fork 的后代执行 setsid，再由可信控制器终止原组并 waitpid 根进程 | setsid 成功；原组 SIGKILL 成功、根被回收后，后代仍通过测试管道响应 | 允许 fork 时，原进程组不是不可逃离的实例集合；信号发送成功不能作为 tree=gone |

前四项是当前 UID 下的文件权限实验，没有验证独立账户。文件 ACL 拒绝本身不是突破 Seatbelt 的证据，也不证明独立身份加对象权限必然不可行。已有 FD 实验刻意由可信 fixture 在限制建立前打开文件，不表示 Cherry launcher 已泄漏该 FD；当时自研 supervisor 在加载策略前关闭管理 FD 和非白名单描述符，setup pipe 在 exec 时关闭，MXC 的句柄传递应按实际平台单独验证。标准流和未来 RPC 通道同样属于显式传递的能力，不得绑定到未授权文件或服务。

进程实验通过私有管道握手确保后代已 setsid，才终止本实验创建且根 PID 尚未回收的进程组。后代只响应一次后退出，并有超时退出保护；管道 EOF 不作为完整树回收的证明。未安装 launchd job；本机 `launchd.plist(5)` 的 AbandonProcessGroup 描述也是清理同一进程组，不能据此推导它能回收逃离组的任意后代。[Apple launchd 手册源码](https://github.com/apple-oss-distributions/launchd/blob/main/man/launchd.plist.5)

复现材料在本工作区 `.context/macos-feasibility/`：`probe.c`、`run.py`、运行说明及含源码 SHA-256 的 `evidence.json`。使用 `xcrun clang -Wall -Wextra -Werror -Wno-deprecated-declarations` 编译，Python 编排每次新建 fixture 并恢复清理；这些研究材料未纳入版本库，不能替代受维护的验收测试。

#### Endpoint Security 必须按系统版本区分

传统 [es_new_client](https://developer.apple.com/documentation/endpointsecurity/es_new_client(_:_:)) 覆盖系统事件，要求 entitlement、root 和用户 Full Disk Access。本机 SDK 的 ESClient.h / ESTypes.h 明确这些前提；ESMessage.h 说明消息可能丢失，需要检查序号。传统默认 deadline 行为会终止客户端；Apple 说明超时授权会隐式允许。因此不能仅靠用户态 ES handler 就宣称保护失败时拒绝访问。[Apple ES 授权与 deadline 说明](https://developer.apple.com/videos/play/wwdc2020/10159/)

2026-09-29 核对的 Apple 文档新增以下能力，其文档元数据标注 macOS 27.0：

- [es_new_descendants_client](https://developer.apple.com/documentation/endpointsecurity/es_new_descendants_client(_:_:))：内核按调用进程的后代范围交付 AUTH/NOTIFY，覆盖已有及随后派生的后代；调用者自身仅收到 NOTIFY。仍需 ES entitlement，但不要求 root 或 TCC。其他进程不可见，不能靠它监控任意宿主进程对目录的并发修改。
- [es_set_deadline_miss_mode](https://developer.apple.com/documentation/endpointsecurity/es_set_deadline_miss_mode(_:_:)) 可选择 [FAIL_CLOSED](https://developer.apple.com/documentation/endpointsecurity/es_deadline_miss_mode_fail_closed)：超时拒绝操作且不终止客户端，AUTH 队列满导致消息丢失时也拒绝。它改进了超时/排队失败语义，**不能外推为客户端被杀、断开或删除后仍有保护**。

本机动态符号探针能解析 es_new_client，不能解析 es_new_descendants_client，SDK 也未声明新接口。因此新接口本轮只有官方文档证据，没有运行验收；不能将最低支持系统偷偷改为 27，也不能将新接口行为套用到 26.5。

ES 提供授权事件及文件信息，但不自动生成 Cherry 的对象授权表。即使在 AUTH_OPEN 中检查当前路径，已有硬链接仍可能落在允许路径下；还需证明对象身份、授权根替换、宿主并发变化、已打开 FD 与 mmap 等访问方式的完整语义。后代事件范围同样不是 Job 式整树终止保证，NOTIFY_FORK 的观察不能单独承担创建前限制或整树配额。

#### 候选结论与下一项实验

| 组合 | 当前判断 | 继续推进所需证据或条件 |
| --- | --- | --- |
| Seatbelt 路径规则 / 目录 extension + 进程组回收 | **排除为当前完整契约的充分实现** | 已有对象别名与 setsid 反例；可保留其中有效的基础限制 |
| Seatbelt + 目录 ACL 或继承 ACL | **不能修复对象别名缺口** | 目录继承不覆盖已有 inode；不继续将其当作简单补丁 |
| Seatbelt + 独立身份 + 文件对象 ACL | **未证实可行** | 身份建立权限、公共可读对象、逐对象授权与 deny、并发新对象、用户权限副作用及崩溃恢复；本轮没有独立 UID 实测 |
| Seatbelt + 传统系统级 ES | **未选用，存在部署及失效语义门槛** | entitlement、root/FDA、保护方丢失后仍拒绝的机制；不能把常驻特权组件视为已经获准 |
| Seatbelt + macOS 27 后代 ES client | **保留为下一项优先验证候选** | 合适系统/SDK 与 entitlement；AUTH 对象检查、FAIL_CLOSED、客户端丢失、事件缺口、进程树回收；旧系统方案仍独立待解 |

下一项实验按以下顺序判断，任何前置门槛失败都保留 unavailable：

1. 验证目标系统和 helper 签名 entitlement 是否能创建后代 client，订阅与 FAIL_CLOSED 设置成功后才允许自建目标执行。不请求修改本机系统或部署身份组件。
2. 优先注入 handler 超时、AUTH 队列压力、client 删除/崩溃、host/supervisor 强杀，分别观察请求结果与存活后代。超时拒绝不能替代保护方丢失后的安全证据。
3. 若失败行为满足要求，再验证文件对象授权及后代集合：原目录即时读写成功，已有/并发硬链接、目录替换、既有句柄和 setsid 不扩大授权或逃过清理。没有可靠整树退出证据仍不得返回 tree=gone。

当前得到的是候选收敛与明确反例，尚无满足全部要求的 macOS 后端。保持原目录直接读写和现有 API/RPC 契约；不以隔离副本、只走文件 RPC 或放宽别名规则替代用户要求。

### 2.5 CLI 与库共用后端

暂缓 ES 候选验证，保留便于本机检查的 [CLI](../../packages/sandbox/README.md#cli)。
CLI 是公开 `SandboxManager` API 的调用方，只负责参数转为 `SandboxSpec`、标准流转发、
取消信号和结果展示。它不直接生成 Seatbelt profile、启动进程或实现清理。

调用路径统一为 `CLI / 应用调用方 → SandboxManager → SandboxBackend → 平台启动器`。
参考 SRT 的策略与启动改进应进入共用平台后端，不建立 CLI 专用后端、权限策略或较弱执行模式。

`lab probe` 返回真实后端评估；`lab run` 调用 `start()`，不能跳过检查。当前 macOS
仍因文件对象隔离等缺口拒绝启动，CLI 同样返回 `unavailable` / `target: not-started`；
Linux/Windows 仍未实现。CLI 测试验证与 API 的结果一致、拒绝启动时无目标副作用、
参数校验和不存在的授权路径不被静默忽略。原生隔离行为仍通过共用后端的受控测试验证，
不把拒绝启动测试当作安全隔离已经完成。

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

### 5.2 后端契约验收总表

此表记录 Cherry 后端状态；上游源码、CI 和独立探针仅支持候选判断，不能记为 Cherry 已通过。必需项为不满足、未实现或待验证时均不得宣称可用；未请求的可选配额可以明确不提供。

| 契约项 | macOS | Linux | Windows | 通过所需证据 |
| --- | --- | --- | --- | --- |
| 文件对象与原目录直接读写 | 硬链接、宿主路径替换不满足 | 未实现、待验证 | 未实现、待验证 | 授权内即时修改成功；deny 对象不能经别名、替换或宿主代办访问 |
| 网络与非授权本地通道 | 部分拒绝对照通过，完整边界未知 | 未实现、待验证 | 未实现、待验证 | 直接连接、DNS、IPv6、回环/局域网及非授权本地入口符合有效策略 |
| 凭据、系统服务与运行时例外 | 部分 supervisor 访问拒绝，其余未知 | 未实现、待验证 | 未实现、待验证 | 运行时正常，未授权凭据、桌面和代启动入口不可用；例外逐项列出 |
| 不同信任组实例隔离 | 静态目录对照通过，完整边界未知 | 未实现、待验证 | 未实现、身份粒度待定 | A/B 文件、代理、句柄、临时资源和撤权互不串扰 |
| 启动、整树终止与宿主崩溃 | 单目标路径局部通过，多进程未实现 | 未实现、待验证 | 未实现、待验证 | 限制先于目标执行；根退出、目标派生和宿主强杀后有整树退出证据 |
| 必需保护失败与资源回收 | 公开 API 阻断回归通过，完整动态 probe 待恢复 | 未实现、待验证 | 未实现、待验证 | 缺失/故障时目标不运行；清理失败报告 incomplete 并保留恢复责任 |
| 已声明预算与整树配额 | 部分时间/I/O 预算通过；内存及多进程配额未实现 | 未实现、待验证 | 未实现、待验证 | 真实超限被强制限制，目标及后代均计入承诺范围 |
| Node/Python 与双向 RPC | 包内未实现；SRT 通信探针不计入验收 | 未实现、待验证 | 未实现、待验证 | 真实受限进程完成双向调用、授权拒绝、取消、断线和超限处理 |
| 打包与日常运行 | 仅未签名 arm64 开发构建，待验收 | 部署矩阵待验证 | 一次初始化后非管理员生命周期待验证 | 支持系统/架构的实际安装包可运行；维护与日常启动权限分离 |

### 5.3 下一轮：后端可行性设计与验证

当前优先产出 **macOS 候选设计、最小实验和明确的可行性结论**，再扩展实现。保留 API/RPC 草案、原目录直接读写、原生三平台和日常免提权要求；不通过放宽文件语义或增加跳过验收开关解除阻断。

| 顺序 | 工作与产出 | 验证门槛 |
| --- | --- | --- |
| 1. 文件对象边界 | 比较原生对象约束、事件授权、独立身份与对象权限组合；记录依赖、权限、竞态和回收责任 | 分开覆盖已有别名、目标主动 link/rename、宿主并发添加别名/替换目录及已有句柄；每项有授权内成功对照 |
| 2. 多进程收敛 | 明确可信管理者、实例成员集合、创建/退出观察、宿主死亡后的约束和回收证据 | fork/exec、setsid、根先退出、启动中取消、管理者/宿主强杀后无残余执行；仅 kill 进程组或扫描 PID 不足以证明 |
| 3. 后端机制定案 | 更新 macOS 候选结论；Linux 明确严格 seccomp 与部署条件；Windows 明确信任组身份和普通用户生命周期 | 每项标出复用组件、自有职责、必需失败行为和未满足项；没有证据不将候选写成可用后端 |
| 4. 运行与通信切片 | 隔离边界成立后，从公开 API 启动 Node/Python，接入成熟 RPC 库并完成停止回收 | 通信成功与隔离成立分别验收；补齐共同矩阵、故障注入和实际安装包运行 |

候选实验先记录“限制作用于路径、对象还是身份”“建立限制所需权限”“依赖组件和部署方式”“失败及回收路径”。macOS 的事件授权或身份方案尚未获选，不在本轮安装特权组件或修改用户源文件 ACL。运行时例外与动态 probe 必须随候选一起验证，不能先宣布可用再补安全边界。

若最小实验已证伪某个候选，就记录反例并排除该组合；若当前约束下尚无可行方案，明确保持 unavailable。只有证据表中的必需项通过，才允许推进对应能力的公开执行路径。
