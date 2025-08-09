import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { Model } from '@renderer/types'

// 常量定义
const MAX_DIRECTORIES = 10 // 最多保存10个目录

export interface CodeToolsState {
  // 当前选择的 CLI 工具，默认使用 qwen-code
  selectedCliTool: string
  // 记录用户之前选择的模型
  selectedModel: Model | null
  // 记录用户选择过的所有目录，支持增删
  directories: string[]
  // 当前选择的目录
  currentDirectory: string
}

export const initialState: CodeToolsState = {
  selectedCliTool: 'qwen-code',
  selectedModel: null,
  directories: [],
  currentDirectory: ''
}

const codeToolsSlice = createSlice({
  name: 'codeTools',
  initialState,
  reducers: {
    // 设置选择的 CLI 工具
    setSelectedCliTool: (state, action: PayloadAction<string>) => {
      state.selectedCliTool = action.payload
    },

    // 设置选择的模型
    setSelectedModel: (state, action: PayloadAction<Model | null>) => {
      state.selectedModel = action.payload
    },

    // 添加目录到列表中
    addDirectory: (state, action: PayloadAction<string>) => {
      const directory = action.payload
      if (directory && !state.directories.includes(directory)) {
        // 将新目录添加到开头
        state.directories.unshift(directory)
        // 限制最多保存 MAX_DIRECTORIES 个目录
        if (state.directories.length > MAX_DIRECTORIES) {
          state.directories = state.directories.slice(0, MAX_DIRECTORIES)
        }
      }
    },

    // 从列表中删除目录
    removeDirectory: (state, action: PayloadAction<string>) => {
      const directory = action.payload
      state.directories = state.directories.filter((dir) => dir !== directory)
      // 如果删除的是当前选择的目录，清空当前目录
      if (state.currentDirectory === directory) {
        state.currentDirectory = ''
      }
    },

    // 设置当前选择的目录
    setCurrentDirectory: (state, action: PayloadAction<string>) => {
      state.currentDirectory = action.payload
      // 如果目录不在列表中，添加到列表开头
      if (action.payload && !state.directories.includes(action.payload)) {
        state.directories.unshift(action.payload)
        // 限制最多保存 MAX_DIRECTORIES 个目录
        if (state.directories.length > MAX_DIRECTORIES) {
          state.directories = state.directories.slice(0, MAX_DIRECTORIES)
        }
      } else if (action.payload && state.directories.includes(action.payload)) {
        // 如果目录已存在，将其移到开头（最近使用）
        state.directories = [action.payload, ...state.directories.filter((dir) => dir !== action.payload)]
      }
    },

    // 清空所有目录
    clearDirectories: (state) => {
      state.directories = []
      state.currentDirectory = ''
    },

    // 重置所有设置
    resetCodeTools: (state) => {
      state.selectedCliTool = 'qwen-code'
      state.selectedModel = null
      state.directories = []
      state.currentDirectory = ''
    }
  }
})

export const {
  setSelectedCliTool,
  setSelectedModel,
  addDirectory,
  removeDirectory,
  setCurrentDirectory,
  clearDirectories,
  resetCodeTools
} = codeToolsSlice.actions

export default codeToolsSlice.reducer
