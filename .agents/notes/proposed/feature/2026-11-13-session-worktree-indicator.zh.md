# Agent Note: 会话 worktree 关联与侧栏标识

Status: proposed

[English](2026-11-13-session-worktree-indicator.md) | 中文

## 问题

用户可以在已有对话中要求智能体创建 Git worktree，并在其中开发功能。shell 创建成功，后续命令也可能显式进入该目录，但 Cherry 没有属于这个会话的记录来表达这一选择。shell 内的 `cd` 不会改变运行时工作区，因此侧栏无法将这个对话与原项目中的其他对话区分开。

在触发本提案的对话中，智能体执行了 `git worktree add -b feat/session-worktree-indicator ../cherry-studio-session-worktree origin/main`，随后执行以 `cd ../cherry-studio-session-worktree &&` 开头的命令。这表明了关联意图，并不等于应用层已经切换工作区。

## 提案

保持会话原工作区绑定及现有消息锁不变。通过会话数据服务，在 SQLite 中为每个会话持久化一条可选的开发 worktree 关联，并追加迁移。保存规范化的 worktree 根目录及仓库身份；当前分支从 Git 读取，不信任模型提供的名称。

提供第一方智能体工具，用于关联或清除当前会话的 worktree。创建仍通过普通 shell 操作完成；创建成功后，智能体显式关联目标。用户要求时也可关联已有 worktree。工具从可信调用上下文取得会话身份，不得指定其他会话，并遵循现有工具权限与审批边界。引导要求智能体在采用 worktree 完成本任务时关联，而不是仅创建目录就关联。

主进程通过 Git、参数数组、规范路径及公共 Git 目录进行校验。仅接受属于原工作区所在仓库、确实存在的 linked worktree；拒绝主检出目录、无关仓库和普通目录。相对输入以原工作区为基准解析。请求被拒绝时保留原关联。Git 操作在同步数据库事务之外执行；服务在提交前确认会话原绑定未变化。

侧栏从会话列表数据读取关联，在截图的前导位置、对话名称之前显示小型分支树图标。未关联的行保持现有外观。使用现有 UI 组件和本地化无障碍文本；悬停显示目录与当前分支，包括 detached HEAD。关联时、激活会话时及新一轮开始前刷新 Git 状态，不在每次行渲染时刷新。无效关联保留已存路径，但显示不可用状态，而不是正常标识。

在后续智能体上下文中提供已验证的关联，包括恢复会话及压缩后的上下文。要求智能体通过显式 worktree 路径或每条命令的工作目录进行开发。第一版不热切换原生运行时 cwd、不悄悄扩大文件权限、不重写原生历史、不迁移会话产物，也不改变文件面板根目录。关联表达已记录的开发目标，不保证所有工具的默认 cwd 已改变。工具结果和上下文必须说明这一限制。目标缺失或无效时标记为不可用；引导不得悄悄回退到原工作区写入。

关联不绕过现有路径授权。清除关联会移除图标和后续 worktree 引导，但绝不删除目录或分支。将会话移入回收站也不删除 worktree。其他对话不受影响，包括共享同一工作区的对话。这不是 worktree 管理器、shell 命令解析器或仓库级自动发现功能。其他执行后端的原生 worktree 工具只有使用此显式契约后，才算建立产品层关联。

## 已考虑的替代方案

- 解析 `git worktree add` 和 shell 输出：脚本、嵌套命令、失败及多个目标，使创建行为无法可靠表达采用意图。
- 扫描仓库全部 worktree：没有证据表明哪个对话使用哪个目标，尤其在并发会话中。
- 替换 `session.workspace`：会放宽无关的消息锁，并改变运行时、文件面板与原生历史语义，超出标识需求。
- 只保存临时 UI 标记：丢失目录、校验、重启恢复与后续上下文。
- 立即改变所有运行时工具的默认目录：需要独立的原生运行时及授权契约；显式路径让第一版保持真实且范围有限。

## 验收标准

- AC1 — shell 创建后成功关联时，仅调用会话显示前导分支树图标；普通会话及仅创建 worktree 的会话保持不变。 (verification: renderer and Electron; owner: sidebar implementer)
- AC2 — 真实 Git 测试仓库接受原仓库中已有的 linked worktree，包括带空格路径及 detached HEAD；主检出目录、缺失路径、普通目录及无关仓库均被拒绝，且不改变已有关联。 (verification: main unit and database; owner: session data implementer)
- AC3 — 关联在重启及列表重载后保留，不改变原工作区；向前迁移保留已有会话数据及无关会话。 (verification: database and Electron; owner: session data implementer)
- AC4 — 后续轮次及恢复或压缩后的上下文标明已验证目标并要求显式 worktree 路径，同时原生默认 cwd、现有访问限制与会话产物位置保持不变。 (verification: focused runtime tests and Electron; owner: runtime implementer)
- AC5 — 删除或使 linked worktree 失效后，在激活会话或下一轮时呈现不可用标识与上下文；不得显示正常状态，也不得引导开发悄悄回退到原目录。 (verification: main, renderer, and Electron; owner: runtime implementer)
- AC6 — 清除关联移除图标和后续引导但不删除 Git 数据；工具不能修改其他会话，也不能绕过工具审批及文件系统权限。 (verification: main tool and database tests; owner: tool implementer)
- AC7 — 在深色、浅色及窄侧栏布局下，前导图标和本地化提示清晰可辨，不遮挡会话名称或已有运行及审批状态。 (verification: renderer and Electron; owner: sidebar implementer)

## 风险

模型可能忘记关联通过 shell 创建的 worktree。工具引导和显式成功结果让采用行为可见，但刻意不以 shell 解析兜底。必须能发现原工作区所属仓库；不包含仓库的系统工作区不能建立此关联。

外部操作可能删除 worktree 或改变分支。Git 状态是某个时刻的观测，不是执行沙箱。重新校验限定在采用、激活及轮次边界；现有文件系统授权仍具有最终约束力。detached 目标有效，不得误判为缺失分支错误。

持久化和显示关联本身不授予工具访问原工作区之外路径的权限，仍可能需要现有审批。必须明确引导使用显式路径，避免让人误以为运行时 cwd 已经切换。
