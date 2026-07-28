## Session / Workspace 架构设计

### 1. 功能背景

当前产品里有两类 workspace：

1. **User-owned workspace**
   - 用户可以在 workspace renderer 中手动创建。
   - 用户可以手动删除。
   - 用户可以重命名。
   - 多个 session 可以绑定到同一个 user-owned workspace。
   - user-owned workspace 对应的是用户自己的目录，应用永远不删除这些真实目录。
   - 如果用户目录缺失、不可访问、或不是目录，runtime 应该直接报错，不自动创建。

2. **System-owned workspace**
   - 当用户选择“不使用已有 workspace / No project”时，系统会在创建 session 前创建一个 workspace 记录。
   - 这个 workspace 与 session 是一对一关系。
   - create 阶段会生成并保存 system workspace 的 `path`，但不会创建真实目录。
   - system workspace 的 `path` 必须位于应用管理的 system workspace root 下。
   - 删除该 session 时，只删除对应的 session/workspace 数据关系与 workspace 记录。
   - 不在 session 删除流程里删除真实文件目录。
   - system-owned workspace 对应的真实目录由应用拥有，但目录不在 create 阶段创建，而是在 runtime 启动前按需创建。

### 2. 目标行为

当前想要的 session 创建、运行与删除逻辑是：

| 用户行为 / 系统阶段 | 期望逻辑 |
| --- | --- |
| 用户选择已有 workspace | 创建 session，并绑定用户选择的 `workspaceId` |
| 用户选择 No project | 系统创建一个 system workspace row，然后创建 session 并绑定它 |
| 创建新 session 但没有显式 workspace | 不应该自动继承最近 session 的 workspace |
| 启动 user-owned workspace session | runtime 只校验目录是否存在、是否目录、是否可访问；失败则暴露错误 |
| 启动 system-owned workspace session | runtime 如果发现目录不存在，则先创建该系统目录，再继续校验 |
| 删除 user-owned workspace | 删除该 workspace 对应的所有 session 和 workspace row |
| 删除 system-owned session | 删除对应的一对一 system workspace row / 绑定关系 |
| 删除 user-owned workspace | 永远不删除用户自己的真实目录 |
| 删除 system-owned session/workspace | 不在该流程里删除真实目录 |
| 后续清理 system-owned 真实目录 | 统一放到设置页缓存清除 / 系统工作目录清理能力中处理 |

### 3. 数据层约束

这里的核心定义是：

- `session.workspaceId` 是一个**数据层绑定**。
- session 必须绑定到某个 workspace row。
- workspace row 里的 `path` 只是数据字段。
- session create 阶段不保证该 path 一定真实存在、可访问、可运行。
- 删除 session/workspace 只处理数据库记录和绑定关系。
- 删除逻辑不负责删除真实文件目录。
- user-owned workspace 的真实目录永远不由应用删除。
- system-owned workspace 的真实目录可以由 runtime 在执行前按需创建。
- system-owned workspace 的 `path` 仍然在 create 阶段生成并保存，runtime 只按已保存的 path 做准备。
- system-owned workspace 与 session 的一对一关系只通过 `session.workspaceId -> workspace.id` 表达，不需要 workspace 反向绑定 session。
- workspace path 的真实可用性由 runtime 校验负责。

也就是说，session 与 workspace 的关系是数据关系，不是文件系统可用性保证。

### 4. Runtime 职责

runtime 是真实目录状态的负责人。

它需要区分 workspace 类型：

1. **User-owned workspace**
   - 如果目录存在、是 directory、且可访问，则继续运行。
   - 如果目录缺失、不可访问、或不是 directory，则直接报错。
   - 不自动创建用户目录。
   - 不删除用户目录。

2. **System-owned workspace**
   - 如果目录不存在，runtime 启动前可以创建该目录。
   - 创建前必须确认该 path 位于应用管理的 system workspace root 下。
   - runtime 只允许为 system-owned workspace 创建目录，不允许为 user-owned workspace 创建目录。
   - ensure 逻辑必须幂等：目录已存在则继续，目录缺失则创建，路径存在但不是 directory 则报错。
   - 创建后继续校验是否是 directory、是否可访问。
   - 如果创建或校验失败，则暴露 runtime 错误。
   - 不在 session/workspace delete 流程中删除真实目录。

因此 `assertClaudeCodeWorkspaceDirectory` 当前如果只是 pure assert，可以保留这个纯校验语义；但应该在它之前增加一层更明确的 runtime preparation，例如：

```ts
prepareClaudeCodeWorkspaceDirectory(session)
```

大致语义是：

```ts
if (session.workspace.type === 'system') {
  ensureSystemWorkspaceDirectory(session.workspace.path)
}

assertClaudeCodeWorkspaceDirectory(session.id, session.workspace.path)
```

这样职责更清楚：

- `prepareClaudeCodeWorkspaceDirectory`：负责 runtime 启动前的 workspace 准备。
- `ensureSystemWorkspaceDirectory`：只允许对 system-owned workspace 创建真实目录，并且必须校验 path 位于应用管理的 system workspace root 下。
- `assertClaudeCodeWorkspaceDirectory`：继续只负责校验目录状态。
- user-owned workspace 永远不会被自动创建或删除。

### 5. 之前讨论中的误判点

一开始我把 session create/delete 理解成了一个带强 filesystem side effect 的 workflow。

基于这个假设，我认为：

- session create 可能需要创建真实 workspace 目录；
- 删除 system-owned session 可能需要删除真实 workspace 目录；
- create/delete 阶段需要保证 workspace 目录状态；
- 因此 renderer 侧应该通过窄 IPC 进入 main workflow；
- DataApi 不适合承担 session create。

但这个判断过强了。

现在重新明确后，真实需求并不是“创建或删除 session 时处理真实文件目录”，而是：

- 创建 session 时只建立数据绑定；
- 删除 session/workspace 时只删除数据库记录和绑定关系；
- workspace path 是否真实可用，由 runtime 执行前准备和校验；
- system-owned workspace 的真实目录可以在 runtime start 时按需创建；
- session create/delete 不需要关心真实目录状态；
- 用户自己的真实目录永远不由应用删除。

因此之前把 session create/delete 强行归类为 filesystem orchestration，是不准确的。

### 6. 当前修正后的架构判断

如果 session create 只做以下事情：

1. 创建 session row；
2. 绑定已有 `workspaceId`；
3. 或者创建 system workspace row 后绑定；
4. 为 system workspace 生成并保存位于 system workspace root 下的 `path`；
5. 不检查真实目录；
6. 不创建真实目录；
7. 不自动继承最近 workspace；

并且 session/workspace delete 只做以下事情：

1. 删除 session row；
2. 删除对应 workspace row；
3. 删除数据层绑定关系；
4. 不删除真实目录；

那么它们仍然可以是 DataApi 操作。

也就是说，关键问题不是“必须改成窄 IPC”，而是：

- 不要有隐藏的 workspace 继承逻辑；
- session 必须显式绑定 workspace；
- create/delete 层只维护数据关系；
- runtime 层负责 system directory ensure 和 directory validation。
- task/channel 创建 session 时也应该使用同样的显式 workspace binding 语义，不能继续依赖 latest session workspace fallback。

### 7. 后续规划：系统工作目录清理

真实工作目录清理只针对**系统创建的目录**。

也就是说：

- user-owned workspace 对应用户自己的目录，应用永远不删除。
- system-owned workspace 如果后续需要清理真实目录，会统一放到设置页的“缓存清除 / 清理系统工作目录”能力中处理。
- session/workspace create/delete 流程不负责真实目录删除。

这样可以保持职责统一：

- session/workspace API 只管理数据库记录和绑定关系；
- runtime 负责执行前 system directory ensure 和目录校验；
- 设置页缓存清理负责系统创建目录的真实文件删除；
- 用户目录完全不进入应用删除范围。

这样比在多个业务删除入口里散落真实目录清理逻辑更清晰，也更容易控制风险。

### 8. 最终结论

最终我倾向于这样的设计：

- 保留 `POST /agent-sessions` 作为 DataApi 创建入口。
- 删除“省略 workspaceId 时自动继承最近 session workspace”的逻辑。
- 创建 session 时必须明确 workspace 绑定来源：
  - existing user workspace
  - system workspace for No project
- session create 不调用 `assertClaudeCodeWorkspaceDirectory`。
- session create 不创建真实目录。
- session/workspace delete 不删除真实文件目录。
- runtime 执行前继续校验真实目录问题。
- runtime 对 system-owned workspace 支持 mkdir-if-missing。
- runtime 对 system-owned workspace mkdir 前必须校验 path 位于应用管理的 system workspace root 下。
- runtime ensure 必须幂等：目录存在则继续，目录缺失则创建，路径存在但不是目录则报错。
- runtime 对 user-owned workspace 只报错，不自动创建。
- user-owned workspace 删除时，删除对应 sessions 和 workspace row，但永远不删除用户自己的真实目录。
- system-owned workspace 与 session 一对一，删除 session 时删除对应 workspace row / 绑定关系，但不在该流程里删除真实目录。
- system-owned workspace 与 session 的一对一关系只通过 `session.workspaceId -> workspace.id` 表达；workspace row 不需要任何反向 session 字段。
- task/channel 创建 session 也应遵循同样的显式 workspace binding 语义，不能继续依赖 latest session workspace fallback。
- 系统创建的真实工作目录如果后续需要删除，统一放到设置页缓存清除能力中处理。
- 所有真实目录是否存在、是否可访问，都不属于 session create/delete 的职责，而属于 runtime / cleanup 职责。

基于上面的功能背景和职责划分，我现在认为：

> session create/delete 不需要移动到窄 IPC。
> 只要它们不做真实 filesystem 校验/操作，而只是创建/删除 DB row 和 workspace 绑定关系，保留 DataApi 是合理的。
> 真正需要修正的是去掉隐式继承 latest workspace 的 fallback，并让 workspace binding 显式化。
> system-owned workspace 的真实目录在 runtime start 时按需创建；user-owned workspace 永远不自动创建也不删除。
> 系统创建的真实目录后续统一交给设置页缓存清理能力处理。
