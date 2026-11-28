# Agent Note: Agent 斜杠命令不进入 Cherry 会话历史

Status: proposed

[English](2026-11-28-agent-slash-command-submission.md) | 中文

## 问题

Agent 输入框目前把大多数斜杠命令作为普通聊天输入发送。runtime 还未报告命令执行结果，主进程就已经预留了用户消息和助手回复，输入框也会记住命令，按 ↑ 时可以调出。现有的直连压缩路径可以跳过这些写入。runtime 的 `locally-handled` 回执在写入之后才到，无法用来统一这项策略。

## 提案

根据当前会话的命令目录识别 Agent 输入框里提交的斜杠命令。手输命令和从快捷面板选择的命令使用同一套匹配规则。未匹配的文本和路径继续走普通消息链路。执行前，主进程重新校验命令和选中的会话上下文。已识别的命令失效时，反馈失败并保留草稿。

在普通消息接收和输入历史记录之前分流。命令原文不进入 Cherry 用户消息、输入框历史和会话参考历史。用命令请求标识关联本次执行和可能出现的原生输入回显。实际回复继续使用现有的消息树。

具体 runtime 负责执行。Pi 和 Pi Durable 保留目标行为，Codex 使用原生控制或回合，Claude 和 ACP 可以用原生用户输入传递命令。调用这个输入接口本身无法证明已经执行模型回合。同一个命令的结果可能随参数或 runtime 状态变化，因此用实际执行证据判断，省去静态回合标记。保留现有的[目标策略](../feature/2026-10-11-agent-runtime-goal.md)和[原生压缩契约](../simplification/2026-11-12-native-agent-compaction.md)。

本地命令结果通过操作反馈呈现。命令启动模型工作时，在所选分支保留真实回复及其运行生命周期，无需为命令调用新增用户消息。重新打开会话后仍能查看回复，Cherry 的会话投影排除原生命令回显。原生记录的保留方式由 harness 协议决定。

保留已确认的原生上下文切换，包括在会话的同一位置连续重置。上下文边界可以承载原生绑定标识，无需保存命令原文或生成虚构回复。

复用 Agent 输入框的快捷面板，补全草稿开头的命令名。命令可以在会话目录中声明结构化的 `subcommands` 列表。准确匹配命令名后，用目录条目补全第一个参数，开始输入后续自由文本参数时结束子命令补全。命令所属的 runtime 提供候选。Pi 和 Pi Durable 提供各自能解析的目标操作，Codex 提供自己的目标操作和 `/plan off`。原生目录没有结构化候选时，仍可补全命令名。

按 Tab、在高亮候选上按 Enter 或点击候选，都会将候选填入草稿。用户通过现有发送动作提交。补全只替换当前词，保留词外的文本和附件，并沿用输入法和关闭面板的现有行为。

打开或重新激活普通 ACP、Claude Agent、本地 Claude Code 或 Codex 会话时，沿现有连接路径刷新命令目录。Main 复用可用连接，或等待正在进行的打开或恢复操作。Claude 读取 SDK 目录，已连接的 Codex 重新读取 Skill 列表。历史页、已归档会话或非活跃标签不会为了读取命令启动 runtime。Pi 和 Pi Durable 使用内置目录。

Pi 和 Pi Durable 也从会话可用的托管与工作区 Skill 中提供 `/skill:<name>` 补全，沿用现有 Skill 生效规则。Cursor 为其文档列出的用户和项目 Skill 目录提供相同语法。Cherry 从 Skill 描述文件读取候选名称和说明，再请 Cursor agent 按现有工具权限读取选中的描述文件。Cursor SDK 没有公开原生 Skill 发现和调用能力。ACP 命令目录仍由各 harness 提供。

提交 Skill 命令时会根据所选会话重新验证候选。Runtime 通过现有斜杠命令分发，以 Skill 引用和可选参数启动模型回合。Cherry 保留助理回复，调用原文不进入会话历史和输入召回。

## 备选方案

- 只在渲染进程过滤命令文本。命令行仍留在产品消息树和输入历史中，也可能改变后续回放时被视作会话输入的内容。
- 给每个命令添加静态回合标记。它无法描述 Codex `/plan` 这类行为取决于参数的命令，也无法证明动态发现的命令实际做了什么。
- 从原生参数提示字符串提取子命令。提示可以描述任意文本或 runtime 专属语法，解析它可能会推荐 runtime 从未声明的调用。

## 验收标准

- AC1 — 在 Agent 输入框手输或选择已知命令可以执行，Cherry 不新增用户消息，按 ↑ 也不会调出该命令。未识别的斜杠文本仍作为普通文本提交。（verification: renderer and Electron — implementation owner）
- AC2 — Pi 和 Pi Durable 的目标控制、原生压缩和 Codex 控制命令保留现有作用，通过反馈呈现本地结果，且不会产生合成会话回复。（verification: runtime and Main — implementation owner）
- AC3 — Claude 和 ACP 命令仍然到达原生输入接口。产生模型回复的命令可以流式展示回复，重新打开后仍可阅读，Cherry 历史中没有命令回显。（verification: native runtime and Main — implementation owner）
- AC4 — 命令目录过期或连接变化时，已识别的命令不会作为普通聊天发送，也不会在不同分支上执行。拒绝后仍可使用草稿。（verification: Main and renderer — implementation owner）
- AC5 — 连续原生重置后，即使重置之间没有普通消息，后续输入和重新打开会话都会使用最新绑定。（verification: Main and native runtime — implementation owner）
- AC6 — 输入 `/go` 这样的前缀可以补全为目录中匹配的命令。选择候选只修改草稿，当前词以外的文本保持完整。（verification: renderer and Electron — implementation owner）
- AC7 — 在 `/goal` 后输入空格会打开所选 runtime 的子命令候选。输入 `/goal pa` 会筛选出 `pause`，选择后草稿为待发送的 `/goal pause`。Codex 不显示 Pi 的 `edit`、`rounds` 和 `budget` 候选。（verification: catalog and renderer — implementation owner）
- AC8 — 未识别的斜杠文本、第一个参数之后的新参数，以及缺少子命令元数据的原生命令均不会打开子命令补全。按 Escape 保留已输入的草稿。（verification: renderer — implementation owner）

- AC9 — 打开或切回普通 Claude 或 Codex 会话时，界面从当前连接更新命令说明。切回 Codex 后可以看到更新后的 Skill 元数据。浏览只读历史或非活跃标签时不会为此打开连接。（verification: renderer, Main and native catalog — implementation owner）

- AC10 — Pi 和 Pi Durable 补全会话可用的 Skill 名称和说明。Cursor 补全受支持目录里的用户和项目 Skill。选择候选只修改草稿。提交已知 Skill 命令时，runtime 收到选中的描述文件和参数，Cherry 保留真实回复且没有命令消息或 ↑ 召回记录。补全后被移除的 Skill 提交时会被拒绝，草稿保留。（verification: catalog, runtime, and renderer — implementation owner）

## 风险

普通回合接收和原生输入恢复目前都关联一条已保存的用户消息。命令执行需要在没有该消息的情况下保留回复归属、取消、分支定位和恢复。原生传输接受输入时，可能还未将其放入回合。连接在分发中关闭时应保留不确定状态，避免自动重复执行。

有些子命令只在特定 runtime 状态下有效。候选反映支持的语法，执行时仍会校验当前状态。
