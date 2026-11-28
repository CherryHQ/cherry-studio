# Agent Note: 本地 Agent 的启动级模型绑定

Status: proposed

[English](2026-11-27-local-agent-launch-model-binding.md) | 中文

## Problem

为本地 CLI Agent 选择 Cherry 模型时，会改写该 CLI 的全局配置——`~/.claude/settings.json`、`~/.codex/auth.json` 以及另外二十个 CLI 的主目录——写入面向用户的 API Gateway 地址及其长期 key，并在固定端口上持久开启该网关。用户自己的 CLI 从此依赖 Cherry 运行且端口与 key 不变。key 以明文留在用户常同步的 dotfiles 中。一份全局文件既无法为不同 Agent 保存不同模型，也经不起用户与其他工具的并发修改。Codex 会失去 ChatGPT 登录模式。

只有 OpenCode 和 Kilo 在启动时把文件里的 key 换成会话凭证。其余 CLI，包括 Cherry 自己启动的会话，都使用从用户文件读到的公共 key。DeepAgents 和 Junie 已经在启动时绑定模型且不触碰用户文件，于是两套互不兼容的机制并存。托管的 OpenClaw 和 DeepSeek Harness 服务也以同样方式把网关选择写入用户的原生主目录。

## Proposal

[Agent 的 provider 绑定](2026-11-26-desktop-agent-runtime-capabilities.md#agent-provider-data-model)保存默认的 Cherry 模型选择。选择、切换或清除 Cherry 模型不写任何 CLI 文件，也不启动或开启面向用户的网关。

Cherry 为该 Agent 启动的每个进程都在启动时获得这一选择：聊天会话、定时任务以及从 Cherry 打开的终端。Main 解析 Cherry 模型，选出 CLI 接受的端点，并从内部回环网关取得限定于这次启动和该模型的凭证。随后应用预设的绑定，并在进程结束时释放凭证和绑定占用的资源。模型目录、账号和登录探测不做绑定。

每个提供 Cherry 模型的预设在共享的启动绑定表中恰有一项：

- **进程级。** 只用环境变量和参数，适用于启动时配置优先于用户文件的 CLI。Claude Code 通过 SDK flag settings 应用 base URL、token 和模型角色，其优先级高于用户设置。Codex 用 `-c` 覆盖选择 Cherry provider，key 从子进程环境读取。OpenCode 和 Kilo 通过 `OPENCODE_CONFIG_CONTENT` 和 `KILO_CONFIG_CONTENT` 接收生成的配置，并与用户已传入的值合并。goose 和 GLM 通过各自预设的启动钩子以环境变量接收生成的连接。DeepAgents 保留其模型参数和环境变量。
- **Overlay 主目录。** CLI 文档化的主目录变量指向这次启动专用、由 Cherry 拥有的目录。各 CLI 的配置适配器以用户当前文件加 Cherry provider 为输入，把该 CLI 的配置文件渲染到这个目录。其他条目都链接到用户主目录：目录用 symlink（Windows 用 junction），文件用 symlink（Windows 用硬链接，不支持时退回副本）。启动结束时，CLI 新建的条目回到用户主目录；被 CLI 替换的文件仅在用户文件期间未变时写回，被 CLI 删除的文件也仅在同一条件下删除。生成的文件直接丢弃。启动时按同一规则回收异常退出遗留的 overlay。若预设的主目录变量不能重定向全部生成文件，则在写入任何内容之前让启动失败。
- **私有文件。** Junie 保留其连接级模型 profile。

| 策略 | 预设 | 重定向方式 |
|---|---|---|
| 进程级 | Claude Code、Codex、OpenCode、Kilo、goose、GLM、DeepAgents | flag settings、`-c`、`*_CONFIG_CONTENT`、环境变量、参数 |
| Overlay 主目录 | Kimi、Pi、OMP、Qwen、CodeBuddy、Copilot、Vibe、Grok Build、Cline、ZCode、Snow | `KIMI_CODE_HOME`、`PI_CODING_AGENT_DIR`、`QWEN_HOME`、`CODEBUDDY_CONFIG_DIR`、`COPILOT_HOME`、`VIBE_HOME`、`GROK_HOME`、`CLINE_DIR`、`ZCODE_HOME`、`SNOW_CONFIG_DIR` |
| 私有文件 | Junie | 连接级 profile |
| 无 | Factory Droid、Poolside、Hermes、MiniMax Code 与仅支持原生模型的预设 | 不提供 Cherry 模型 |

Hermes 不提供 Cherry 模型。每个 Hermes 客户端都会为自己的主目录启动一个脱离父进程的 gateway 守护进程，它比启动本身活得更久；Hermes 还会记录运行时主目录的绝对路径。因此 overlay 主目录会把运行中的守护进程和过期路径带进用户主目录，后续启动随之失败。Hermes 也没有优先级高于配置文件的启动期设置。

MiniMax Code 不提供 Cherry 模型。`mcode` 会拒绝 `MINIMAX_DATA_DIR` 内的符号链接（包括 `v2`、`v2/sqlite` 及 profile 存储），也没有优先级高于 `MINIMAX_DATA_DIR/config.yaml` 的启动期参数或配置覆写项。

各 CLI 的配置适配器从 renderer 移到 `@shared/utils/cliConfig`。Main 用原始配置编辑器已在使用的同一份代码渲染 overlay 文件，每种 CLI 文件格式只有一个所有者。原始 **CLI 配置文件** 编辑器仍是用户显式编辑自己文件的入口。

对 API Gateway 模型，托管共享服务遵循同样的所有权。Cherry 为经由 API Gateway 提供的模型启动 OpenClaw Gateway 或 DeepSeek Harness 时，服务读取 Cherry 在用户主目录之外生成的配置，并使用服务级凭证，Cherry 在服务停止时释放该凭证。直连服务商的选择仍写入服务的原生配置。Cherry 仅复用的外部服务，其配置保持不动。

移除写文件的网关选择、从用户文件重新读取网关路由的逻辑、`bindCliGatewayRoute`，以及 Agent 对面向用户网关的依赖。

本 note 部分取代 [桌面 Agent 的运行能力](2026-11-26-desktop-agent-runtime-capabilities.md) 中关于网关路由的段落。该 note 中的会话级归属仍然有效。

## Alternatives considered

- **继续写用户文件，但改用会话凭证。** 仍然改动用户的全局配置，仍会破坏 Cherry 之外的 CLI，仍无法按 Agent 保存模型。
- **重定向 `HOME`。** 子进程将看不到 macOS Keychain 凭证和其他工具的 dotfiles。
- **每个 Agent 一个持久私有主目录。** 会话、skills 和设置与用户的 CLI 分叉。同一 Agent 的并发启动会争用共享文件里的凭证。
- **在各运行时包中手写 provider 片段。** 重复配置适配器已掌握的文件格式知识，并让编辑器与启动逐渐不一致。

## Acceptance criteria

- AC1 — 为任一预设选择、切换或清除 Cherry 模型后，用户各 CLI 主目录中的文件均不变，`feature.api_gateway.enabled` 也不变。（verification: unit and renderer）
- AC2 — 每个具备绑定的预设，其聊天会话把模型请求发往内部网关，所用凭证限定于该会话和模型，会话关闭后凭证不再授权请求。（verification: unit）
- AC3 — 同一 Agent 的两个并发会话获得不同的凭证和不同的 overlay 目录。（verification: unit）
- AC4 — 在 overlay 主目录中，CLI 能读到用户已有的会话、skills、MCP 配置和登录状态。启动结束后，它新建的条目存在于用户主目录，被修改的副本仅在用户文件未变时写回，用户主目录中不残留任何生成文件或 Cherry 凭证。（verification: unit）
- AC5 — 异常退出后，下次启动按 AC4 规则处理每个遗留 overlay 并将其删除。（verification: unit）
- AC6 — 若预设的主目录变量会让某个生成文件落在 overlay 之外，启动以明确错误失败，且不向用户主目录写入任何内容。（verification: unit）
- AC7 — 设置了 Cherry 模型的 Agent，其定时任务和从 Cherry 打开的终端通过同一绑定使用所选模型。（verification: unit）
- AC8 — Agent Services 只为声明了绑定的预设提供 Cherry 模型，Factory Droid、Poolside 和 Hermes 不提供。（verification: renderer）
- AC9 — Cherry 为 API Gateway 模型启动的 OpenClaw Gateway 和 DeepSeek Harness 读取 Cherry 生成的配置和服务级凭证，不向用户的原生配置写入网关路由或凭证，并在服务停止时释放凭证。直连服务商的选择和外部服务保持现有配置。（verification: unit）
- AC10 — 本地 Agent 运行时参考文档描述启动级绑定，不再记载写文件的网关选择。（verification: docs gate）

## Risks

- Windows 用 junction 链接目录、用硬链接链接文件。CLI 以重命名方式替换的文件会断开硬链接，并在启动结束时写回；不支持硬链接的卷退回副本。
- 会话期间改写生成文件的 CLI 会丢失这些修改，因为生成文件会被丢弃。
- 若 CLI 轮换存放在生成文件中的 OAuth refresh token，只有 overlay 副本被轮换。Cherry 模型会话使用网关凭证而非 CLI 账号认证，影响有限。
- Cherry 无法感知它打开的终端何时退出，因此终端的绑定保留到 Cherry 停止。从 Cherry 打开的终端在 Cherry 退出后比其凭证活得久。内部网关随 Cherry 停止，该终端在重新从 Cherry 打开前无法使用 Cherry 模型。
- CLI 升级可能移动文件或改名主目录变量。AC6 检查会把这类变化变成启动错误，而不是写入用户主目录。
