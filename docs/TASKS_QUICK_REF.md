# 任务功能快速参考指南

> 完整文档请参考 [TASKS_FEATURE.md](./TASKS_FEATURE.md)

## 📁 关键文件速查

```
任务功能核心文件:
├── src/renderer/src/pages/tasks/
│   ├── TasksPage.tsx                    # 主页面（侧边栏+详情面板）
│   └── components/
│       ├── TaskDetailPanel.tsx          # 任务详情和执行历史
│       └── TaskEditPopup.tsx            # 创建/编辑表单
├── src/renderer/src/store/
│   ├── tasks.ts                         # Redux Slice (reducers, selectors)
│   └── tasksThunk.ts                    # Redux Thunks (异步操作)
├── src/renderer/src/services/
│   └── TaskExecutionService.ts          # AI 执行逻辑
└── src/renderer/src/types/
    └── task.ts                          # TypeScript 类型定义

IPC 通信:
├── packages/shared/IpcChannel.ts        # IPC 通道定义
└── src/preload/index.ts                 # Preload API 暴露
```

## 🐛 常见问题速查

### 问题: 执行历史不更新
```typescript
// ❌ 错误: 本地 state 缓存 task 对象
const [selectedTask, setSelectedTask] = useState(task)

// ✅ 正确: 只存储 ID，从 Redux 获取最新数据
const [selectedTaskId, setSelectedTaskId] = useState(task.id)
const selectedTask = useMemo(
  () => tasks.find((t) => t.id === selectedTaskId),
  [tasks, selectedTaskId]
)
```

### 问题: 任务超时（0.3秒）
```typescript
// ✅ 确保 maxExecutionTime 从秒转换为毫秒
const timeoutMs = (task.execution.maxExecutionTime || 300) * 1000
```

### 问题: 编辑按钮不工作
```typescript
// ✅ TaskDetailPanel 需要 onEdit prop
<TaskDetailPanel
  onEdit={() => {
    setEditMode('edit')
    setEditPopupOpen(true)
  }}
/>
```

## 🔧 执行流程图

```
用户点击"立即执行"
    ↓
TaskDetailPanel.handleRun()
    ↓
dispatch(executeTaskThunk(taskId))
    ↓
executeTask thunk
    ├─ 查找任务
    ├─ executeTaskDirect(task)
    │   ├─ 创建执行记录 (status: running)
    │   ├─ executeSingleTarget()
    │   │   └─ executeWithAssistant()
    │   │       └─ aiProvider.completions()
    │   ├─ 更新执行记录 (status: completed/failed)
    │   └─ return execution
    ├─ saveExecution() → 存储
    └─ dispatch(addExecution())
        ↓
    Redux Reducer 更新 state
        ↓
    UI 自动重新渲染
```

## 📝 数据模型速查

```typescript
// 任务
PeriodicTask {
  id, name, description, emoji
  targets: [{ type, id, name }]
  schedule: { type, description }
  execution: { message, maxExecutionTime, ... }
  executions: TaskExecution[]  // 最近10条
  totalRuns, lastRunAt, enabled
}

// 执行记录
TaskExecution {
  id, taskId, status
  startedAt, completedAt
  result?: { success, output, error, duration }
}
```

## 🎨 UI 组件关系

```
TasksPage
├── TaskSideNav (左侧边栏)
│   ├── FilterSection (筛选按钮)
│   ├── TaskList (任务列表)
│   └── AddTaskItem (创建按钮)
├── TaskContent (主内容区)
│   └── TaskDetailPanel
│       ├── TaskHeader (标题+操作按钮)
│       ├── TaskSections
│       │   ├── 调度配置
│       │   ├── 执行目标 (新增)
│       │   ├── 执行配置
│       │   └── 执行历史列表 (CompactExecutionList + 分页控件)
│       └── (操作按钮: 立即执行/编辑/删除)
└── ExecutionDetailPanel (右侧，条件渲染)
    └── 执行详情 (点击执行记录后显示)
```

## 🔍 调试日志

所有调试日志前缀为 `[TASKS]`，在浏览器控制台搜索：

```
[TASKS] executeTask thunk 开始
[TASKS] 开始任务执行
[TASKS] 正在执行助手任务
[TASKS] aiProvider.completions 调用完成
[TASKS] 任务执行完成
[TASKS REDUX] addExecution
```

## ⚙️ Redux Actions

```typescript
// 同步 actions (tasks.ts)
dispatch(addTask(task))
dispatch(updateTask(task))
dispatch(deleteTask(taskId))
dispatch(addExecution({ taskId, execution }))
dispatch(setFilter('all' | 'enabled' | 'disabled'))

// 异步 thunks (tasksThunk.ts)
await dispatch(createTask(form))
await dispatch(updateTask(task))
await dispatch(deleteTask(taskId))
await dispatch(executeTask(taskId))  // 核心
await dispatch(loadTasksFromStorage())
```

## 🌍 i18n 键

```typescript
// 常用翻译键
t('tasks.title')              // 任务
t('tasks.create')             // 创建任务
t('tasks.edit')               // 编辑任务
t('tasks.run')                // 立即执行
t('tasks.empty')              // 暂无任务
t('tasks.filter.all')         // 全部
t('tasks.form.name')          // 任务名称
t('tasks.form.message')       // 执行消息
// ... 更多见完整文档
```

## 🚀 快速开始

### 添加新功能

1. **添加新的调度类型**:
   - 修改 `TaskSchedule` 类型
   - 更新 `TaskEditPopup` 表单
   - 实现调度逻辑

2. **添加新的执行状态**:
   - 修改 `TaskStatus` 类型
   - 更新 UI 显示逻辑
   - 添加状态图标

3. **添加新的表单字段**:
   - 修改 `TaskExecutionConfig` 类型
   - 更新 `TaskEditPopup` 表单
   - 更新 i18n 翻译

### 代码片段

```typescript
// 创建新任务
const task: CreateTaskForm = {
  name: '我的任务',
  targets: [
    { type: 'assistant', id: 'xxx', name: '助手' },
    { type: 'agent', id: 'yyy', name: '代理' }
  ],
  schedule: { type: 'manual', description: '手动触发' },
  execution: {
    message: '你好',
    continueConversation: false,
    maxExecutionTime: 300,
    notifyOnComplete: true
  },
  enabled: false
}
await dispatch(createTask(task))

// 执行任务
await dispatch(executeTask(taskId))

// 添加执行记录
dispatch(addExecution({
  taskId: 'task-xxx',
  execution: {
    id: 'exec-xxx',
    taskId: 'task-xxx',
    status: 'completed',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    result: { success: true, output: '结果', duration: 5000 }
  }
}))
```

### 执行目标显示

任务详情中的"执行目标" section 会自动显示所有目标：

```typescript
// task.targets 数组
targets: [
  { type: 'assistant', id: 'assistant-123', name: 'Default Assistant' },
  { type: 'agent', id: 'agent-456', name: 'Code Review Agent' }
]

// UI 显示
① Default Assistant   助手   assistant-123...
② Code Review Agent  代理   agent-456...
```

## 📊 性能优化

- ✅ 使用 `useMemo` 避免不必要的重新计算
- ✅ 使用 `useCallback` 缓存事件处理器
- ✅ Redux Toolkit 的 Immer 自动优化不可变更新
- ✅ 执行历史限制为最近10条

## 🔐 安全考虑

- ✅ 用户输入经过验证（Form.Item rules）
- ✅ AI 调用有超时保护
- ✅ 错误信息不暴露敏感数据
- ✅ 删除操作需要确认

---

**最后更新**: 2025-03-01
**完整文档**: [TASKS_FEATURE.md](./TASKS_FEATURE.md)
