# Agent Note: 在 Linux 和 WSL2 上，当 Claude Code CLI 报告可以运行时启用 Agent shell 沙箱

Status: proposed

[English](2026-11-28-agent-sandbox-platform-availability.md) | 中文

## 问题

[Agent shell 命令的基础沙箱策略](2026-11-26-builtin-agent-sandbox.md)只在 `darwin` 上解析出策略。在 Linux、WSL2 和 Windows 上，Cherry Support 的每条 Bash 调用仍要逐次审批，所以大部分桌面用户完全享受不到审批卡片的减少。

Claude Code CLI（2.1.311，随 Agent SDK 0.3.311 一起提供）在 macOS 之外也能把 Bash 放进沙箱：

- Linux 和 WSL2 需要 `bubblewrap` 和 `socat`，还需要内核允许 bubblewrap 创建用户命名空间。在 Ubuntu 上，`kernel.apparmor_restrict_unprivileged_userns=1` 会阻止它，除非 bubblewrap 有 AppArmor 配置文件。WSL1 不支持。
- 原生 Windows 需要执行一次 `claude sandbox install`，会提权一次。CLI 自己的文案里还提到 Windows 沙箱“not active on this session (feature gate off)”，所以即使装好了，沙箱也可能不可用。

CLI 自己的检查并没有覆盖它的 Linux 沙箱所需的全部条件。它的 seccomp 辅助程序会在 bubblewrap 里面再嵌套创建一个用户命名空间，而 Ubuntu 自带的 AppArmor 配置文件 `bwrap-userns-restrict`（Ubuntu 26.04 默认加载）不给 bubblewrap 的子进程做这件事所需的权限。于是 `status` 报告沙箱可用，但每条沙箱命令都会在执行前失败。这是 CLI 一个尚未修复的问题（[anthropics/claude-code#43454](https://github.com/anthropics/claude-code/issues/43454)），它文档里给的补救办法也解除不了这个配置文件。

Cherry 没法根据平台判断一台机器是否满足这些条件。最直接的捷径 `failIfUnavailable: false` 并不安全：这样设置后，CLI 起不来沙箱时会不带沙箱运行 Bash，而 Cherry 的守卫仍把这个连接当作已沙箱化，跳过逐次审批卡片。

## 提案

一个连接是否获得沙箱，取决于它的运行时是否报告沙箱可用。唯一保留的平台规则是：原生 Windows 在验证之前不启用。

*基础策略。* `resolveSandboxPolicy` 不再读取平台，而是把运行时给出的可用性作为输入。没有 overlay，或者沙箱不可用时，它不解析出策略，Agent 保持现有的审批行为。可写路径沿用 POSIX 规则，覆盖 macOS、Linux 和 WSL2。

*Claude Code 的可用性。* 在构建一个需要沙箱的连接之前，Claude Code 适配器用内置的 CLI 执行 `claude sandbox status`。它把 `CLAUDE_CONFIG_DIR` 设为一个新建的临时目录，其中的 `settings.json` 开启沙箱，因此不会读取或改动用户自己的 Claude Code 设置。`status` 输出一行 JSON。其中的 `unavailableReason` 和让 `failIfUnavailable` 拒绝启动会话的是同一项检查，所以对同一台机器和同一套策略，两者不会给出不同结论。只有以下条件全部满足，才算沙箱可用：

- 进程在 5 秒内以 0 退出；
- 输出能解析为 JSON，且 `statusVersion` 为 `3`；
- `supported` 和 `enabled` 都是 `true`；
- `unavailableReason` 为 `null`。

其他任何情况都算不可用。在 Linux 上，`status` 报告可用的沙箱还要再通过一次试验：`bwrap --unshare-user --dev-bind / / unshare --user --map-root-user true` 在 5 秒内以 0 退出。这正是 CLI 的 seccomp 辅助程序要创建、而 `status` 没有试过的嵌套用户命名空间。Codex、Gemini CLI 和 Zed 安装 seccomp 过滤器时都不嵌套命名空间，所以它们都不需要这项试验；它们和 CLI 做的 bubblewrap 探测都只试到上一层。等 CLI 不再嵌套命名空间，之后的改动会去掉这项试验。

因为每次构建连接都会检查一次，新装的依赖在下一个连接就会生效，不做缓存。在 macOS 上实测，一次检查热启动 0.14 秒，冷启动 0.6 秒。

*不可用时。* 连接不带 `sandbox` 选项，`sandboxed` 为 `false`。因此 `support-bash` 在 Full Access 以外对每条 shell 调用都要求审批，和现在 Linux、Windows 上的行为完全一样。`status` 给出的原因会连同会话 id 记进日志，诊断时可以看到沙箱为什么没开。沙箱不可用不算回合错误：在这些平台上，这是没有配置过的机器的正常状态。

*可用时。* 连接按 macOS 的方式构建：同样的 SDK 选项、同样的配置层验证、同样的 `sandbox-escape` 和 Support 规则，以及同样的失败时出沙箱引导。`failIfUnavailable` 保持为 `true`。如果 CLI 仍然起不来沙箱，例如在状态检查和启动之间某个依赖被删除，本轮会明确失败，而不是不带沙箱运行。

*原生 Windows。* 适配器把原生 Windows 直接视为不可用，不执行 `status`，无论 CLI 会报告什么。Windows 沙箱在 Cherry 里还没有任何验证：安装状态、功能开关、出沙箱引导所依赖的拒绝信息格式，以及 Windows 路径如何进入策略。之后的 Spec 会在一台执行过 `claude sandbox install` 的 Windows 机器通过原生测试后启用它，并决定 Cherry 是否提供安装入口；安装会改动机器，需要管理员同意。WSL2 运行的是 Linux 版 CLI，按 Linux 规则处理。PowerShell 在所有平台上都保持逐次审批，因为目前验证过的沙箱覆盖范围只有 Bash 工具。

*在 CI 里验证 Linux。* Linux 测试任务安装 `bubblewrap` 和 `socat`，并在该任务内解除 Ubuntu 的 AppArmor 用户命名空间限制、卸载 `bwrap-userns-restrict` 配置文件，这样原生沙箱测试就在一个能用的沙箱上运行。不做这些步骤时，同一个测试覆盖的是不可用这条路径。

## 已考虑的替代方案

- 在 Cherry 里重复 CLI 的依赖检查（在 `PATH` 上找 `bwrap` 和 `socat`、试跑一次 bubblewrap、读取 AppArmor 开关）：重复了 CLI 已经做的检查，CLI 改动时还会和它不一致；也回答不了 Windows 的安装状态和功能开关。Cherry 只做 CLI 漏掉的那一项嵌套命名空间试验。
- 设置 `allowAllUnixSockets: true`：CLI 会跳过 seccomp 辅助程序，沙箱在默认的 Ubuntu 上也能运行，但沙箱里的命令可以连到任意 Unix socket，例如 `/tmp` 下的那些。
- 让用户卸载 `bwrap-userns-restrict`：这会削弱不归 Cherry 管的系统加固。改为在日志的原因里写明问题出在哪。
- 用 `failIfUnavailable: true` 启动会话，CLI 拒绝启动时再不带沙箱重建：每台没有沙箱的机器在每个连接上都要白白失败一次 CLI 启动，而且依赖解析错误信息，而不是一个带版本号的状态格式。
- `failIfUnavailable: false`：已在“问题”一节否决。CLI 会不带沙箱运行 Bash，而 Cherry 却跳过审批卡片。
- 在整个 App 生命周期内缓存可用性：每个连接能省约 0.15 秒，但用户装好 bubblewrap 或执行 `claude sandbox install` 后结果就过时了，还要额外的失效规则。
- 在原生 Windows 上也信任 `status`：CLI 自己的检查会做出判断，但 Cherry 这一侧的 Windows 路径没有任何验证，而且某个 CLI 版本可能在 Cherry 没有任何改动的情况下就在那里启动沙箱。
- 现在就加一个 Windows 安装按钮：它需要提权操作、确认文案和失败处理，而且 CLI 的 Windows 功能开关还没验证。这属于之后的 Windows Spec。

## 验收标准

- AC1 — 在 macOS 上，`claude sandbox status` 报告沙箱可用后，Support 会话得到的 `sandbox` 选项和审批行为与本次改动之前相同。 (verification: 单元测试和 macOS 原生测试, owner: Claude Code 运行时实施者)
- AC2 — 当 `claude sandbox status` 以非 0 退出、5 秒内没有结束、输出不是 JSON、`statusVersion` 不是 `3`、`supported` 或 `enabled` 为 `false`，或 `unavailableReason` 不为空时，连接不带 `sandbox` 选项，Support 的每条 Bash 和 PowerShell 调用在 Full Access 以外都要求审批，并记录原因。 (verification: 单元测试, owner: Claude Code 运行时实施者)
- AC3 — 在没有 `bubblewrap` 的 Linux CI 机器上，`claude sandbox status` 报告沙箱不可用，Support 会话回到逐次审批。 (verification: Linux 原生测试, owner: Claude Code 运行时实施者)
- AC4 — 在装好 `bubblewrap` 和 `socat`、解除 AppArmor 用户命名空间限制并卸载 `bwrap-userns-restrict` 的 Linux CI 机器上，Support 的 Bash 命令不弹卡片就运行，连不上 `example.com` 和本地回环服务器，写不到工作区、Agent 数据目录和临时目录以外的位置，工具结果里带有出沙箱引导。带 `dangerouslyDisableSandbox` 的调用会进入 `canUseTool`，被拒绝时不会执行。 (verification: Linux 原生测试, owner: Claude Code 运行时实施者)
- AC5 — 在原生 Windows 上，Support 会话不带 `sandbox` 选项，保持逐次审批，并且不执行状态检查。 (verification: 单元测试和 Windows 原生测试, owner: Claude Code 运行时实施者)
- AC6 — 可用性为 `false` 时，`resolveSandboxPolicy` 不解析出策略；为 `true` 时，解析出的策略与以前相同，所有平台都是如此；它不再自己读取操作系统。 (verification: 单元测试, owner: 沙箱策略实施者)
- AC7 — 状态检查不会读取或改动用户的 Claude Code 配置目录，也不会留下临时目录。 (verification: 单元测试, owner: Claude Code 运行时实施者)
- AC8 — 在 Linux 上，当 `claude sandbox status` 报告沙箱可用，但 bubblewrap 无法创建嵌套用户命名空间时（例如加载了 Ubuntu 的 `bwrap-userns-restrict` 配置文件），连接不带 `sandbox` 选项，Support 保持逐次审批，日志里的原因写明 anthropics/claude-code#43454。`status` 已经报告不可用时，不做这项试验。 (verification: 单元测试, owner: Claude Code 运行时实施者)

## 风险

- `status` 的输出格式可能在以后的 CLI 里变化。把 `statusVersion` 固定为 `3`，未知格式就会被当作“不可用”，从而保持逐次审批；Linux 和 Windows 的原生测试会发现改变了格式的 SDK 升级。
- 每次构建需要沙箱的连接，状态检查要花 0.15 到 0.6 秒。预热查询本来就会提前构建连接，能遮住大部分耗时。
- 在 CLI 修复 anthropics/claude-code#43454 之前，默认加载 `bwrap-userns-restrict` 的 Ubuntu 版本（例如 26.04）会保持逐次审批。这个 Spec 在 Linux 上带来的好处，会先落到没有这个配置文件的发行版上，例如 Debian、Fedora 和 Arch。
- 这项试验需要 util-linux 里的 `unshare`。没有它的系统算作不可用。
- 解除 AppArmor 限制和卸载配置文件都只在 CI 任务内生效。这两项中任何一项还在的 Ubuntu 桌面用户都会保持逐次审批；日志里的原因会写明这一点。
- Linux 和 WSL2 的沙箱还没在 Cherry 里用真实模型跑过。失败时的引导依赖 CLI 在 Linux 上像在 macOS 上一样输出 `deny network-outbound <host>`；AC4 会检查这个格式。
- 这个 Spec 不改变 Windows 用户的行为。这是有意排除：如果不明确排除，某个激活了 Windows 沙箱的 CLI 版本会让 Support 在没有任何验证的情况下切换过去。
