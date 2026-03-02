/**
 * Redux slice for managing periodic tasks
 */

import { loggerService } from '@logger'
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { CreateTaskForm, PeriodicTask, TaskExecution } from '@types'

const logger = loggerService.withContext('tasksSlice')

export interface TasksState {
  tasks: PeriodicTask[]
  selectedTaskId: string | null
  filter: 'all' | 'enabled' | 'disabled'
  searchQuery: string
}

const initialState: TasksState = {
  tasks: [],
  selectedTaskId: null,
  filter: 'all',
  searchQuery: ''
}

const tasksSlice = createSlice({
  name: 'tasks',
  initialState,
  reducers: {
    addMultipleTasks: (state, action: PayloadAction<PeriodicTask[]>) => {
      state.tasks = action.payload
    },
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
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload
    },
    addExecution: (state, action: PayloadAction<{ taskId: string; execution: TaskExecution }>) => {
      const taskIndex = state.tasks.findIndex((t) => t.id === action.payload.taskId)
      if (taskIndex !== -1) {
        const task = state.tasks[taskIndex]
        // 检查是否已存在相同 ID 的执行记录（更新情况）
        const existingIndex = task.executions.findIndex((e) => e.id === action.payload.execution.id)

        let executions: TaskExecution[]
        if (existingIndex !== -1) {
          // 更新现有执行记录
          executions = [...task.executions]
          executions[existingIndex] = action.payload.execution
        } else {
          // 添加新的执行记录到开头（最新的在前）
          // 保留最近 100 条记录
          executions = [action.payload.execution, ...task.executions].slice(0, 100)
        }

        console.log(
          '[TASKS REDUX] addExecution:',
          'taskId=' + action.payload.taskId,
          'executionId=' + action.payload.execution.id,
          'status=' + action.payload.execution.status,
          'existingIndex=' + existingIndex
        )
        logger.info(
          `addExecution: taskId=${action.payload.taskId}, executionId=${action.payload.execution.id}, status=${action.payload.execution.status}, existingIndex=${existingIndex}`
        )

        // Create new task object to ensure re-render
        state.tasks[taskIndex] = {
          ...task,
          executions,
          totalRuns: existingIndex === -1 ? task.totalRuns + 1 : task.totalRuns,
          lastRunAt: action.payload.execution.completedAt || action.payload.execution.startedAt,
          updatedAt: new Date().toISOString()
        }

        console.log('[TASKS REDUX] 任务更新完成，执行记录数:', executions.length)
        logger.info(`addExecution: 任务更新完成，执行记录数：${executions.length}`)
      } else {
        console.error('[TASKS REDUX] 未找到任务，taskId:', action.payload.taskId)
        logger.error(`addExecution: 未找到任务，taskId=${action.payload.taskId}`)
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
      let filtered = state.tasks

      // Apply filter (all/enabled/disabled)
      switch (state.filter) {
        case 'enabled':
          filtered = filtered.filter((t) => t.enabled)
          break
        case 'disabled':
          filtered = filtered.filter((t) => !t.enabled)
          break
        default:
          break
      }

      // Apply search query
      if (state.searchQuery && state.searchQuery.trim()) {
        const query = state.searchQuery.toLowerCase()
        filtered = filtered.filter(
          (t) => t.name.toLowerCase().includes(query) || (t.description && t.description.toLowerCase().includes(query))
        )
      }

      return filtered
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

export const {
  addMultipleTasks,
  addTask,
  updateTask,
  deleteTask,
  toggleTaskEnabled,
  setSelectedTask,
  setFilter,
  setSearchQuery,
  addExecution
} = tasksSlice.actions
export const { getAllTasks, getTaskById, getSelectedTask, getFilteredTasks, getTaskListItems } = tasksSlice.selectors

// Type-safe selector for accessing from root state
export const selectTasks = (state: { tasks: TasksState }) => state.tasks

export default tasksSlice.reducer
