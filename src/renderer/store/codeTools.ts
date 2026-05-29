/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import type { Model } from '@renderer/types'
import { codeCLI, terminalApps } from '@shared/config/constant'

// 常量定义
const MAX_DIRECTORIES = 10 // 最多保存10个目录

export interface CodeToolsState {
  // 当前选择的 CLI 工具，默认使用 qwen-code
  selectedCliTool: codeCLI
  // 为每个 CLI 工具单独保存选择的模型
  selectedModels: Record<string, Model | null>
  // 为每个 CLI 工具单独保存环境变量
  environmentVariables: Record<string, string>
  // 记录用户选择过的所有目录，支持增删
  directories: string[]
  // 当前选择的目录
  currentDirectory: string
  // 选择的终端 ( macOS 和 Windows)
  selectedTerminal: string
}

export const initialState: CodeToolsState = {
  selectedCliTool: codeCLI.qwenCode,
  selectedModels: {
    [codeCLI.qwenCode]: null,
    [codeCLI.claudeCode]: null,
    [codeCLI.geminiCli]: null,
    [codeCLI.openaiCodex]: null,
    [codeCLI.iFlowCli]: null,
    [codeCLI.githubCopilotCli]: null,
    [codeCLI.kimiCli]: null,
    [codeCLI.openCode]: null
  },
  environmentVariables: {
    'qwen-code': '',
    'claude-code': '',
    'gemini-cli': '',
    'openai-codex': '',
    'iflow-cli': '',
    'github-copilot-cli': '',
    'kimi-cli': '',
    opencode: ''
  },
  directories: [],
  currentDirectory: '',
  selectedTerminal: terminalApps.systemDefault
}

const codeToolsSlice = createSlice({
  name: 'codeTools',
  initialState,
  reducers: {
    // 设置选择的 CLI 工具
    setSelectedCliTool: (state, action: PayloadAction<codeCLI>) => {
      state.selectedCliTool = action.payload
    },

    // 设置选择的终端
    setSelectedTerminal: (state, action: PayloadAction<string>) => {
      state.selectedTerminal = action.payload
    },

    // 设置选择的模型（为当前 CLI 工具设置）
    setSelectedModel: (state, action: PayloadAction<Model | null>) => {
      state.selectedModels[state.selectedCliTool] = action.payload
    },

    // 设置环境变量（为当前 CLI 工具设置）
    setEnvironmentVariables: (state, action: PayloadAction<string>) => {
      if (!state.environmentVariables) {
        state.environmentVariables = {
          'qwen-code': '',
          'claude-code': '',
          'gemini-cli': '',
          'openai-codex': '',
          'iflow-cli': '',
          'github-copilot-cli': '',
          'kimi-cli': '',
          opencode: ''
        }
      }
      state.environmentVariables[state.selectedCliTool] = action.payload
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
      state.selectedCliTool = initialState.selectedCliTool
      state.selectedModels = initialState.selectedModels
      state.environmentVariables = initialState.environmentVariables
      state.directories = initialState.directories
      state.currentDirectory = initialState.currentDirectory
      state.selectedTerminal = initialState.selectedTerminal
    }
  }
})

export const {
  setSelectedCliTool,
  setSelectedTerminal,
  setSelectedModel,
  setEnvironmentVariables,
  addDirectory,
  removeDirectory,
  setCurrentDirectory,
  clearDirectories,
  resetCodeTools
} = codeToolsSlice.actions

export default codeToolsSlice.reducer
