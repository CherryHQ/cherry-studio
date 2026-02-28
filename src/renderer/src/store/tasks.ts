/**
 * Redux slice for managing periodic tasks
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { CreateTaskForm, PeriodicTask, TaskExecution } from '@types'

export interface TasksState {
  tasks: PeriodicTask[]
  selectedTaskId: string | null
  filter: 'all' | 'enabled' | 'disabled'
}

const initialState: TasksState = {
  tasks: [
    // Demo task
    {
      id: 'demo-task-1',
      name: '每日日报摘要',
      description: '每天下午6点生成工作日报摘要',
      emoji: '📋',
      targets: [
        {
          type: 'assistant',
          id: 'default',
          name: '默认助手'
        }
      ],
      schedule: {
        type: 'cron',
        cronExpression: '0 18 * * *',
        description: '每天 18:00'
      },
      enabled: true,
      execution: {
        message: '请帮我生成今天的工作日报摘要',
        continueConversation: false,
        maxExecutionTime: 300,
        notifyOnComplete: true
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalRuns: 0,
      executions: []
    },
    {
      id: 'demo-task-2',
      name: '代码检查',
      description: '每周一上午检查代码质量',
      emoji: '🔍',
      targets: [
        {
          type: 'agent',
          id: 'claude-code',
          name: 'Code Reviewer'
        }
      ],
      schedule: {
        type: 'cron',
        cronExpression: '0 9 * * 1',
        description: '每周一 09:00'
      },
      enabled: false,
      execution: {
        message: '请检查本周代码变更并提供代码质量报告',
        continueConversation: true,
        maxExecutionTime: 600,
        notifyOnComplete: true
      },
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 86400000).toISOString(),
      totalRuns: 3,
      executions: [
        {
          id: 'exec-1',
          taskId: 'demo-task-2',
          status: 'completed',
          startedAt: new Date(Date.now() - 604800000).toISOString(),
          completedAt: new Date(Date.now() - 604740000).toISOString(),
          result: {
            success: true,
            output: '代码检查完成，发现 3 个需要改进的地方...'
          }
        },
        {
          id: 'exec-2',
          taskId: 'demo-task-2',
          status: 'completed',
          startedAt: new Date(Date.now() - 1209600000).toISOString(),
          completedAt: new Date(Date.now() - 1209540000).toISOString(),
          result: {
            success: true,
            output: '代码检查完成，代码质量良好'
          }
        },
        {
          id: 'exec-3',
          taskId: 'demo-task-2',
          status: 'failed',
          startedAt: new Date(Date.now() - 1814400000).toISOString(),
          completedAt: new Date(Date.now() - 1814380000).toISOString(),
          result: {
            success: false,
            error: 'Agent 服务暂时不可用'
          }
        }
      ]
    }
  ],
  selectedTaskId: null,
  filter: 'all'
}

const tasksSlice = createSlice({
  name: 'tasks',
  initialState,
  reducers: {
    addTask: (state, action: PayloadAction<CreateTaskForm>) => {
      const newTask: PeriodicTask = {
        ...action.payload,
        id: `task-${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalRuns: 0,
        executions: []
      }
      state.tasks.push(newTask)
    },
    updateTask: (state, action: PayloadAction<PeriodicTask>) => {
      const index = state.tasks.findIndex((t) => t.id === action.payload.id)
      if (index !== -1) {
        state.tasks[index] = {
          ...action.payload,
          updatedAt: new Date().toISOString()
        }
      }
    },
    deleteTask: (state, action: PayloadAction<string>) => {
      state.tasks = state.tasks.filter((t) => t.id !== action.payload)
      if (state.selectedTaskId === action.payload) {
        state.selectedTaskId = null
      }
    },
    toggleTaskEnabled: (state, action: PayloadAction<string>) => {
      const task = state.tasks.find((t) => t.id === action.payload)
      if (task) {
        task.enabled = !task.enabled
        task.updatedAt = new Date().toISOString()
      }
    },
    setSelectedTask: (state, action: PayloadAction<string | null>) => {
      state.selectedTaskId = action.payload
    },
    setFilter: (state, action: PayloadAction<'all' | 'enabled' | 'disabled'>) => {
      state.filter = action.payload
    },
    addExecution: (state, action: PayloadAction<{ taskId: string; execution: TaskExecution }>) => {
      const task = state.tasks.find((t) => t.id === action.payload.taskId)
      if (task) {
        task.executions.unshift(action.payload.execution)
        // Keep only last 10 executions
        if (task.executions.length > 10) {
          task.executions = task.executions.slice(0, 10)
        }
        task.totalRuns += 1
        task.lastRunAt = action.payload.execution.startedAt
      }
    }
  },
  selectors: {
    getAllTasks: (state) => state.tasks,
    getTaskById: (state) => (id: string) => state.tasks.find((t) => t.id === id),
    getSelectedTask: (state) => {
      if (!state.selectedTaskId) return null
      return state.tasks.find((t) => t.id === state.selectedTaskId) || null
    },
    getFilteredTasks: (state) => {
      switch (state.filter) {
        case 'enabled':
          return state.tasks.filter((t) => t.enabled)
        case 'disabled':
          return state.tasks.filter((t) => !t.enabled)
        default:
          return state.tasks
      }
    },
    getTaskListItems: (state) => {
      return state.tasks.map((task) => ({
        id: task.id,
        name: task.name,
        emoji: task.emoji,
        enabled: task.enabled,
        schedule: task.schedule,
        lastRunAt: task.lastRunAt,
        nextRunAt: task.nextRunAt,
        totalRuns: task.totalRuns,
        targetNames: task.targets.map((t) => t.name).join(', ')
      }))
    }
  }
})

export const { addTask, updateTask, deleteTask, toggleTaskEnabled, setSelectedTask, setFilter, addExecution } =
  tasksSlice.actions
export const { getAllTasks, getTaskById, getSelectedTask, getFilteredTasks, getTaskListItems } = tasksSlice.selectors

// Type-safe selector for accessing from root state
export const selectTasks = (state: { tasks: TasksState }) => state.tasks

export default tasksSlice.reducer
