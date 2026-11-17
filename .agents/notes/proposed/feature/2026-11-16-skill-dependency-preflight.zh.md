# Agent Note: 技能前置依赖检查与经批准的隔离安装

Status: proposed

[English](2026-11-16-skill-dependency-preflight.md) | 中文

## 问题

已安装的技能只是一个已登记的文件夹。它所需的可执行文件、运行时版本、包和平台假设，要等 Agent 运行时才会发现；Agent 随后可能把依赖装进用户的任务工作目录并卡住（#20162）。因此“已安装”并不代表它能运行。

目前没有任何解析器读取依赖声明：`parseSkillMetadata`（`src/main/utils/markdownParser.ts:315-410`）只读取 name、slug、description、version、author、tags、tools、allowed tools、context 和 agent。`SkillService` 复制并登记文件夹时不做任何就绪检查（`src/main/ai/skills/SkillService.ts:852`）。

## 提案

### 声明

技能在 SKILL.md 的 frontmatter 中用单个 `requires` 键声明前置依赖。没有该键的技能保持现有行为不变。

```yaml
requires:
  bins: [pandoc]            # executables that must resolve on PATH
  python: ">=3.10"          # optional runtime constraint
  packages:
    pip: [pypdf==5.1.0]     # packages installed into the app-owned environment only
  platforms: [darwin, win32] # optional; omitted means all platforms
```

只识别这四个字段。未知字段会在安装结果中给出警告并被忽略。声明中不包含凭据；需要凭据的技能报告为 `Setup required` 并列出凭据名称，值通过现有的密钥存储输入。

### 就绪状态

每个已安装技能有一个就绪状态，存放在已安装记录中，由主进程计算：

- `ready`：所有声明的依赖已按当前环境指纹验证通过。
- `setup_required`：至少一项依赖缺失或不兼容；记录缺失项。
- `setting_up`：经批准的安装正在进行。
- `failed`：上一次安装以错误、取消或超时结束；记录错误和日志路径。

没有 `requires` 键的技能按定义为 `ready`。指纹包含平台、Cherry Studio 版本、技能内容哈希，以及每个已声明依赖的解析身份：每个可执行文件的解析路径和版本，每个运行时的名称、解析路径和版本。升级、技能更新或 Agent 迁移到其他运行时都会改变指纹，并强制重新检查。

就绪状态还会针对环境重新验证，而不仅是比对存储的指纹：在每次会加载该技能的 Agent 运行之前，重新执行开销很小的前置检查（可执行文件解析和版本读取）。因此，移除像 `pandoc` 这样的已声明可执行文件、就地升级它，或者替换、切换运行时，即使存储的指纹没有变化，也会把技能翻回 `setup_required`。最近一次重新验证未通过的技能，运行绝不会启动它。

### 前置检查

前置检查在技能安装或更新时、指纹变化时，以及每次会加载该技能的 Agent 运行之前执行（即上面的重新验证规则）。它只做检查：解析可执行文件、读取运行时版本、查看应用自有环境。它从不安装任何东西。

若 Agent 运行所用的技能不是 `ready`，该运行不会启动此技能。用户会看到缺失的依赖以及一个设置操作。

### 经批准的安装

只有用户在技能设置中批准某次具体运行后，安装才会执行。每次批准都显示确切的命令和包列表，且仅适用于该次运行；之后的安装需要新的批准。

安装在应用自有目录中执行，该目录通过 `application.getPath` 解析，并在实现层按 `src/main/core/paths/README.md` 为技能命名空间新增一个键。Agent 的任务工作目录永远不是安装目标，安装环境变量也不会泄漏到任务进程。

安装有边界：固定超时、通过现有的进程树终止辅助函数取消，以及启动新的已批准运行的重试操作。每次运行的日志保存在技能的应用自有目录中，失败状态会指明失败的依赖。被取消或失败的安装绝不会让技能保持 `ready`。

### 界面

已安装技能的行和详情展示就绪状态、缺失的依赖，以及“重试”或“设置”操作。在 `setting_up` 期间显示安装进度和日志路径。这复用现有的技能管理界面，不新增页面。

## 考虑过的替代方案

- 使用单独的 `skill.requirements.json` 旁路文件：本阶段否决，因为单个 frontmatter 键能把声明与说明放在一起，且不需要第二种文件格式。
- 让 Agent 在运行中安装缺失的包：否决，因为这会重现报告的故障，并修改任务工作目录。
- 安装时自动执行安装：否决，因为这会在用户未逐次同意的情况下执行作者声明的命令。
- 随应用打包常用运行时（#14893）：不在本范围内；本提案只定义就绪判定和已声明依赖的隔离安装路径。

## 验收标准

- AC1 — 已安装技能若缺少声明的可执行文件，在任何 Agent 运行前即显示为 `setup_required`，且不会启动。(verification: unit and renderer)
- AC2 — `python` 约束不兼容或平台不可用的技能会报告失败的约束，且绝不标记为 `ready`。(verification: unit)
- AC3 — 启动技能从不会向任务工作目录安装包；安装只写入应用自有目录。(verification: main-process integration)
- AC4 — 每次安装都需要显式批准，批准界面显示确切的命令和包，且仅对该次运行有效。(verification: renderer and unit)
- AC5 — 被取消或超时的安装使技能保持 `failed`，保留日志，且在用户重试前不会再次运行。(verification: unit with controlled process termination)
- AC6 — 包安装失败会记录失败的依赖和日志路径；重试会启动新的已批准运行。(verification: unit and renderer)
- AC7 — 没有 `requires` 键的技能保持现有的安装与运行行为。(verification: unit regression)
- AC8 — 升级应用或更新技能会改变指纹，并在下次运行前强制重新检查。(verification: unit)

## 风险

声明的命令和包是不可信的作者输入；批准对话框是唯一的同意关口，因此其显示必须精确。包管理器和解释器在各平台上不同，在一个平台可用的技能在另一个平台上可能被标记为 `setup_required`。应用自有目录的磁盘占用默认无上限，因此需要大小警告。第一阶段接受这些风险；沙箱化的安装运行时不在范围内。

回滚时停用 `requires` 解析器并把所有技能视为 `ready`，从而恢复现有行为。已安装的技能及其应用自有目录会被保留。
