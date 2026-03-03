# Cherry Studio - 任务管理功能文档

## 功能概述

任务管理（Tasks）是一个周期性任务调度器，可以定时或手动触发 AI 助手/代理执行特定任务。

**核心功能：**
- 创建、编辑、删除任务
- 手动立即执行任务
- 查看任务执行历史和详情
- 任务状态跟踪（成功/失败/运行中）
- 执行结果查看和错误追踪

---

## 架构设计

### 技术栈
- **状态管理**: Redux Toolkit
- **UI 组件**: React + Styled Components + Ant Design
- **IPC 通信**: Electron IPC (Renderer ↔ Main)
- **AI 调用**: ModernAiProvider (AI Core)

### 目录结构
```
src/renderer/src/
├── pages/tasks/
│   ├── TasksPage.tsx                    # 主页面
│   └── components/
│       ├── TaskDetailPanel.tsx          # 任务详情面板
│       ├── TaskEditPopup.tsx            # 创建/编辑弹窗
│       ├── TaskCard.tsx                 # (已废弃)
│       └── index.ts
├── store/
│   ├── tasks.ts                         # Redux Slice & Reducers
│   └── tasksThunk.ts                    # Redux Thunks (异步操作)
├── services/
│   └── TaskExecutionService.ts          # 任务执行逻辑
└── types/
    └── task.ts                          # TypeScript 类型定义

packages/shared/
├── IpcChannel.ts                        # IPC 通道定义
└── types/task.ts                        # 共享类型定义
```

---

## 数据模型

### 核心类型

```typescript
// 任务实体
interface PeriodicTask {
  id: string
  name: string
  description?: string
  emoji?: string

  // 目标配置
  targets: TaskTarget[]  // 可以是 assistant, agent, agent_session

  // 调度配置
  schedule: TaskSchedule
  enabled: boolean

  // 执行配置
  execution: TaskExecutionConfig

  // 元数据
  createdAt: string
  updatedAt: string
  lastRunAt?: string
  nextRunAt?: string
  totalRuns: number

  // 执行历史（最近10条）
  executions: TaskExecution[]
}

// 执行记录
interface TaskExecution {
  id: string
  taskId: string
  status: 'idle' | 'running' | 'completed' | 'failed' | 'paused'
  startedAt: string
  completedAt?: string
  result?: {
    success: boolean
    output?: string
    error?: string
    duration?: number
    metadata?: Record<string, unknown>
  }
}

// 任务目标
type TaskTarget = {
  type: 'agent' | 'assistant' | 'agent_session'
  id: string
  name: string
}

// 调度类型
type ScheduleType = 'once' | 'interval' | 'cron' | 'manual'

// 执行配置
interface TaskExecutionConfig {
  message: string                    // 发送给助手的消息
  continueConversation: boolean      // 是否继续之前的对话
  maxExecutionTime: number           // 最大执行时间（秒）
  notifyOnComplete: boolean          // 完成后是否通知
}
```

---

## 功能实现

### 1. 任务列表 (TasksPage)

**布局**: 左侧边栏 + 主内容区 + 右侧详情面板

```typescript
// 文件: src/renderer/src/pages/tasks/TasksPage.tsx

// 主要功能:
- 任务列表显示（左侧边栏）
- 任务筛选（全部/已启用/已禁用）
- 点击任务查看详情（主内容区）
- 点击执行记录查看详情（右侧面板）
- 创建任务按钮
- 任务上下文菜单（重命名/编辑/删除）
```

**关键状态**:
```typescript
const [selectedTaskId, setSelectedTaskId] = useState<string>()
const [selectedExecution, setSelectedExecution] = useState<TaskExecution>()

// 重要: 使用 useMemo 从 Redux store 获取最新的 task 对象
// 这样当执行记录更新时，UI 会自动重新渲染
const selectedTask = useMemo(
  () => tasks.find((t) => t.id === selectedTaskId),
  [tasks, selectedTaskId]
)
```

### 2. 任务详情面板 (TaskDetailPanel)

**显示内容**:
- 任务基本信息（名称、emoji、描述）
- 调度配置（类型、描述）
- **执行目标列表**（序号、名称、类型、ID）
- 执行配置（消息）
- 执行历史列表（支持分页，每页10条）

**操作按钮**:
- 立即执行（仅 manual 类型）
- 编辑任务
- 删除任务

**执行列表项**:
- 开始时间
- 执行状态（成功/失败/运行中）
- 耗时
- 终止按钮（运行中时显示）

**执行目标显示**:
- 圆形序号徽章（1, 2, 3...）
- 目标名称
- 目标类型标签（助手/代理/代理会话）
- 目标 ID（前8位）

### 3. 创建/编辑弹窗 (TaskEditPopup)

**表单字段**:
1. **基本信息**
   - 名称（必填）
   - 描述
   - Emoji

2. **调度配置**
   - 类型（仅支持 manual，其他类型待实现）
   - 描述

3. **目标配置**
   - 选择助手/代理（多选）
   - 支持搜索过滤

4. **执行配置**
   - 消息内容（必填，支持多行文本）
   - 继续对话（Switch）
   - 最大执行时间（秒，默认 300）
   - 完成通知（Switch）

### 4. 任务执行逻辑 (TaskExecutionService)

**执行流程**:
```
1. executeTaskDirect() - 创建执行记录（status: running）
2. executeSingleTarget() / executeMultipleTargets() - 执行 AI 调用
3. executeWithAssistant() - 调用 AI 助手
4. aiProvider.completions() - 实际 AI API 调用
5. 更新执行记录（status: completed/failed）
6. 保存到存储
7. 添加到 Redux store
```

**超时处理**:
```typescript
// maxExecutionTime 单位是秒，需要转换为毫秒
const timeoutMs = (task.execution.maxExecutionTime || 300) * 1000

result = await Promise.race([
  executeSingleTarget(task),
  createTimeoutPromise(timeoutMs)  // 超时后 reject
])
```

**错误处理**:
- 即使 AI 调用失败，也会创建执行记录
- 执行记录保存到 Redux store 和存储
- 显示 toast 通知用户结果

---

## Redux 状态管理

### Slice (tasks.ts)

**Actions**:
```typescript
addMultipleTasks(state, action)     // 批量添加任务
addTask(state, action)               // 添加单个任务
updateTask(state, action)            // 更新任务
deleteTask(state, action)            // 删除任务
setFilter(state, action)             // 设置筛选条件
addExecution(state, action)          // 添加执行记录（重要！）
```

**关键实现 - addExecution**:
```typescript
addExecution: (state, action) => {
  const taskIndex = state.tasks.findIndex((t) => t.id === action.payload.taskId)
  if (taskIndex !== -1) {
    const task = state.tasks[taskIndex]
    const executions = [action.payload.execution, ...task.executions].slice(0, 10)

    // 创建新对象确保 React 重新渲染
    state.tasks[taskIndex] = {
      ...task,
      executions,
      totalRuns: task.totalRuns + 1,
      lastRunAt: action.payload.execution.completedAt || action.payload.execution.startedAt,
      updatedAt: new Date().toISOString()
    }
  }
}
```

**Selectors**:
```typescript
getAllTasks(state)              // 获取所有任务
getTaskById(state)(id)          // 根据 ID 获取任务
getFilteredTasks(state)         // 获取筛选后的任务
getTaskListItems(state)         // 获取列表项数据
```

### Thunks (tasksThunk.ts)

**异步操作**:
```typescript
createTask(form)                // 创建任务
updateTask(task)                // 更新任务
deleteTask(taskId)              // 删除任务
executeTask(taskId)             // 执行任务（核心）
toggleTaskEnabled(taskId)       // 切换启用状态
loadTasksFromStorage()          // 从存储加载任务
```

**核心 Thunk - executeTask**:
```typescript
export const executeTask = (taskId: string) => async (dispatch, getState) => {
  // 1. 查找任务
  const task = getState().tasks.tasks.find((t) => t.id === taskId)

  // 2. 执行任务
  const execution = await executeTaskDirect(task)

  // 3. 保存到存储
  await window.api.task.saveExecution(taskId, execution)

  // 4. 更新 Redux store
  dispatch(addExecution({ taskId, execution }))

  return execution
}
```

---

## IPC 通道

### 通道定义 (IpcChannel.ts)

```typescript
// 任务 CRUD
Task_Create = 'task:create'
Task_Update = 'task:update'
Task_Delete = 'task:delete'
Task_Get = 'task:get'
Task_List = 'task:list'

// 任务执行
Task_ExecuteNow = 'task:execute-now'
Task_Pause = 'task:pause'
Task_Resume = 'task:resume'

// 执行记录
Task_GetExecutions = 'task:get-executions'
Task_SaveExecution = 'task:save-execution'

// 执行事件
Task_ExecutionStarted = 'task:execution-started'
Task_ExecutionProgress = 'task:execution-progress'
Task_ExecutionCompleted = 'task:execution-completed'
Task_ExecutionFailed = 'task:execution-failed'
```

### Preload API (window.api.task)

```typescript
window.api.task = {
  // CRUD
  create(task: CreateTaskForm): Promise<PeriodicTask>
  update(task: UpdateTaskForm): Promise<PeriodicTask | null>
  delete(taskId: string): Promise<boolean>
  get(taskId: string): Promise<PeriodicTask | null>
  list(): Promise<PeriodicTask[]>

  // 执行
  executeNow(taskId: string): Promise<TaskExecution>
  pause(taskId: string): Promise<void>
  resume(taskId: string): Promise<void>

  // 执行记录
  saveExecution(taskId: string, execution: TaskExecution): Promise<void>
  getExecutions(taskId: string, limit?: number): Promise<TaskExecution[]>
}
```

---

## 国际化 (i18n)

### 新增的翻译键

```json
{
  "tasks": {
    "title": "任务",
    "create": "创建任务",
    "edit": "编辑任务",
    "run": "立即执行",
    "delete_confirm": "删除任务",
    "empty": "暂无任务，点击下方按钮创建",
    "rename": "重命名",

    "filter": {
      "all": "全部",
      "enabled": "已启用",
      "disabled": "已禁用"
    },

    "schedule": {
      "manual": "手动触发"
    },

    "schedule_type": {
      "manual": "手动触发",
      "cron": "Cron 表达式",
      "interval": "固定间隔"
    },

    "form": {
      "section_schedule": "调度配置",
      "section_targets": "目标配置",
      "section_execution": "执行配置",

      "name": "任务名称",
      "name_placeholder": "输入任务名称",
      "name_required": "请输入任务名称",

      "description": "任务描述",
      "description_placeholder": "输入任务描述（可选）",

      "emoji": "任务图标",

      "schedule_type": "调度类型",
      "schedule_description": "调度描述",
      "schedule_description_placeholder": "描述调度规则",

      "targets": "执行目标",
      "targets_placeholder": "选择助手或代理",
      "targets_required": "请选择至少一个执行目标",

      "assistants": "助手",
      "agents": "代理",

      "message": "执行消息",
      "message_placeholder": "输入要发送给助手/代理的消息",
      "message_required": "请输入执行消息",

      "continue_conversation": "继续对话",
      "continue_conversation_help": "是否在之前的对话基础上继续",

      "max_execution_time": "最大执行时间（秒）",

      "notify_on_complete": "完成通知",
      "notify_on_complete_help": "任务完成后发送通知"
    }
  }
}
```

---

## 已知问题与解决方案

### 问题 1: 执行历史列表不更新

**原因**: `selectedTask` 使用本地 state 存储 task 对象，当 Redux store 更新时不会自动更新。

**解决方案**: 改用 task ID 并从 Redux store 获取最新数据
```typescript
// 错误做法:
const [selectedTask, setSelectedTask] = useState(task)

// 正确做法:
const [selectedTaskId, setSelectedTaskId] = useState(task.id)
const selectedTask = useMemo(
  () => tasks.find((t) => t.id === selectedTaskId),
  [tasks, selectedTaskId]
)
```

### 问题 2: 任务执行超时

**原因**: `maxExecutionTime` 单位混淆（表单中是秒，代码中当成毫秒）

**解决方案**: 添加单位转换
```typescript
const timeoutMs = (task.execution.maxExecutionTime || 300) * 1000
```

### 问题 3: 编辑按钮功能错误

**原因**: TaskDetailPanel 中的编辑按钮绑定的是 `onClose` 而不是 `onEdit`

**解决方案**: 添加 `onEdit` prop 并正确绑定

### 问题 4: Ant Design Form.Item 警告

**原因**: Form.Item 的 `name` prop 要求只有一个子元素

**解决方案**: 将多个子元素包裹在 div 中
```typescript
<Form.Item name="continueConversation" valuePropName="checked">
  <div>
    <Switch />
    <HelpText>帮助文本</HelpText>
  </div>
</Form.Item>
```

### 问题 5: 删除按钮缺少文字

**原因**: 只显示图标，与其他按钮样式不一致

**解决方案**: 添加文字标签
```typescript
<ActionButton danger onClick={handleDelete}>
  <Trash2 size={12} />
  {t('common.delete')}
</ActionButton>
```

---

## 待实现功能

### 高优先级

1. **终止正在执行的任务**
   - 实现 `handleTerminate` 功能
   - 需要在 AI Core 层面支持请求取消

2. **继续对话功能**
   - `continueConversation` 配置项未实现
   - 需要从之前的对话中获取上下文

3. **定时调度功能**
   - 目前只支持 manual 类型
   - 需要实现 cron、interval 调度器
   - 需要主进程调度服务

4. **执行进度显示**
   - 实时显示执行进度
   - 支持流式输出

### 中优先级

5. **任务分组**
   - 支持任务分组/标签
   - 批量操作

6. **任务模板**
   - 预设常用任务模板
   - 快速创建

7. **执行历史搜索/过滤**
   - 按状态过滤
   - 按日期范围过滤
   - 搜索输出内容

8. **任务导入/导出**
   - 导出任务配置
   - 导入任务配置

### 低优先级

9. **任务依赖**
   - 支持任务间的依赖关系
   - 顺序执行

10. **任务统计**
    - 执行成功率
    - 平均耗时
    - 趋势图表

11. **执行结果导出**
    - 导出为文本/JSON
    - 分享执行结果

---

## 调试指南

### 启用调试日志

所有关键步骤都有 console.log 日志，前缀为 `[TASKS]`：

```typescript
// tasksThunk.ts
console.log('[TASKS] executeTask thunk 开始，taskId:', taskId)

// TaskExecutionService.ts
console.log('[TASKS] 开始任务执行:', executionId)

// Redux reducer
console.log('[TASKS REDUX] addExecution:', taskId, executionId, status)
```

### 常见调试步骤

1. **检查任务是否被创建**:
   - Redux DevTools → State → tasks → tasks
   - 检查任务对象是否完整

2. **检查执行是否被触发**:
   - 控制台查找 `[TASKS] executeTask thunk 开始`
   - 检查后续日志

3. **检查 AI 调用是否成功**:
   - 控制台查找 `aiProvider.completions 调用完成`
   - 检查是否有错误

4. **检查执行记录是否添加**:
   - 控制台查找 `[TASKS REDUX] addExecution`
   - 检查 Redux state 中的 executions 数组

5. **检查 UI 是否更新**:
   - 检查 `selectedTask` 是否使用 `useMemo` 从 Redux 获取
   - 检查 `executions` 数组是否更新

### 日志级别

LoggerService 支持的日志级别：
```typescript
error   // 最高优先级，总是显示
warn    // 警告信息
info    // 一般信息（默认级别）
debug   // 调试信息
verbose // 详细信息
silly   // 最详细
```

---

## 最佳实践

### 1. 状态管理

- ✅ 使用 Redux store 管理任务数据
- ✅ 使用 `useMemo` 从 store 获取最新数据
- ❌ 不要在组件 state 中缓存 task 对象

### 2. 异步操作

- ✅ 使用 Redux Thunk 处理异步逻辑
- ✅ 在 thunk 中处理错误并创建失败记录
- ❌ 不要让组件直接调用服务

### 3. UI 更新

- ✅ Redux reducer 返回新对象（不可变更新）
- ✅ 关键状态变化时创建新对象触发渲染
- ❌ 不要直接修改 state 对象

### 4. 错误处理

- ✅ 所有 async/await 都要用 try-catch 包裹
- ✅ 即使失败也要创建执行记录
- ✅ 显示用户友好的错误消息

### 5. 日志记录

- ✅ 关键步骤添加 console.log 和 logger
- ✅ 使用统一的日志前缀 `[TASKS]`
- ✅ 包含足够的上下文信息

---

## 测试清单

### 功能测试

- [ ] 创建新任务
- [ ] 编辑现有任务
- [ ] 删除任务（带确认）
- [ ] 重命名任务
- [ ] 手动执行任务
- [ ] 查看执行历史
- [ ] 查看执行详情
- [ ] 筛选任务（全部/已启用/已禁用）
- [ ] 多个目标执行
- [ ] 任务执行超时处理

### UI 测试

- [ ] 执行列表显示正确
- [ ] 执行状态显示正确
- [ ] ID 显示后10位
- [ ] 删除按钮显示图标+文字
- [ ] 编辑按钮正常工作
- [ ] 执行后列表立即更新
- [ ] Toast 通知正确显示

### 边缘情况

- [ ] 无目标时执行
- [ ] AI 调用失败
- [ ] 网络错误
- [ ] 执行超时
- [ ] 删除正在执行的任务
- [ ] 执行历史超过10条
- [ ] 并发执行多个任务

---

## 相关资源

### 内部文档
- [AI Core 文档](../aiCore/)
- [Redux Toolkit 文档](https://redux-toolkit.js.org/)
- [Electron IPC 文档](https://www.electronjs.org/docs/latest/tutorial/ipc)

### 类型定义
- `src/renderer/src/types/task.ts` - 任务类型
- `packages/shared/types/task.ts` - 共享类型
- `packages/shared/IpcChannel.ts` - IPC 通道

### 关键文件
- `src/renderer/src/pages/tasks/TasksPage.tsx` - 主页面
- `src/renderer/src/services/TaskExecutionService.ts` - 执行服务
- `src/renderer/src/store/tasks.ts` - Redux slice
- `src/renderer/src/store/tasksThunk.ts` - Redux thunks

---

## 版本历史

### v1.0.0 (当前版本)
- ✅ 基础任务 CRUD
- ✅ 手动执行任务
- ✅ 执行历史查看
- ✅ 执行详情面板
- ✅ 任务筛选
- ✅ AI 助手集成
- ✅ 超时处理
- ✅ 错误处理

### 下个版本计划
- ⏳ 定时调度（cron/interval）
- ⏳ 终止执行
- ⏳ 继续对话
- ⏳ 执行进度
- ⏳ 任务模板

---

**文档更新日期**: 2025-03-01
**最后维护者**: Claude Code Assistant
**状态**: 活跃开发中
