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
  tasks: [],
  selectedTaskId: null,
  filter: 'all'
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

export const {
  addMultipleTasks,
  addTask,
  updateTask,
  deleteTask,
  toggleTaskEnabled,
  setSelectedTask,
  setFilter,
  addExecution
} = tasksSlice.actions
export const { getAllTasks, getTaskById, getSelectedTask, getFilteredTasks, getTaskListItems } = tasksSlice.selectors

// Type-safe selector for accessing from root state
export const selectTasks = (state: { tasks: TasksState }) => state.tasks

export default tasksSlice.reducer
