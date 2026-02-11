import { loggerService } from '@renderer/services/LoggerService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addDirectory,
  clearDirectories,
  removeDirectory,
  resetCodeTools,
  setCurrentDirectory,
  setEnvironmentVariables,
  setSelectedCliTool,
  setSelectedModel,
  setSelectedTerminal
} from '@renderer/store/codeTools'
import type { Model } from '@renderer/types'
import { codeTools } from '@shared/config/constant'
import { message } from 'antd'
import { useCallback } from 'react'

export const useCodeTools = () => {
  const dispatch = useAppDispatch()
  const codeToolsState = useAppSelector((state) => state.codeTools)
  const logger = loggerService.withContext('useCodeTools')

  // 设置选择的 CLI 工具
  const setCliTool = useCallback(
    (tool: codeTools) => {
      dispatch(setSelectedCliTool(tool))
    },
    [dispatch]
  )

  // 设置选择的模型
  const setModel = useCallback(
    (model: Model | null) => {
      dispatch(setSelectedModel(model))
    },
    [dispatch]
  )

  // 设置选择的终端
  const setTerminal = useCallback(
    (terminal: string) => {
      dispatch(setSelectedTerminal(terminal))
    },
    [dispatch]
  )

  // 设置环境变量
  const setEnvVars = useCallback(
    (envVars: string) => {
      dispatch(setEnvironmentVariables(envVars))
    },
    [dispatch]
  )

  // 添加目录
  const addDir = useCallback(
    (directory: string) => {
      dispatch(addDirectory(directory))
    },
    [dispatch]
  )

  // 删除目录
  const removeDir = useCallback(
    (directory: string) => {
      dispatch(removeDirectory(directory))
    },
    [dispatch]
  )

  // 设置当前目录，带路径验证
  const setCurrentDir = useCallback(
    async (directory: string) => {
      // 如果输入为空，则清除当前目录
      if (!directory || directory.trim() === '') {
        dispatch(setCurrentDirectory(''))
        return
      }

      // 验证路径的有效性
      try {
        const validationResult = await window.api.file.validateWorkingDirectory(directory)

        if (validationResult.isValid) {
          dispatch(setCurrentDirectory(directory))
          // 将有效路径添加到历史记录
          dispatch(addDirectory(directory))
        } else {
          // 显示错误信息
          message.error(validationResult.error || 'Invalid directory path')
          logger.warn(`Invalid directory path: ${directory}`, validationResult)
        }
      } catch (error) {
        logger.error('Failed to validate directory:', error as Error)
        message.error('Failed to validate directory path')
      }
    },
    [dispatch, logger]
  )

  // 清空所有目录
  const clearDirs = useCallback(() => {
    dispatch(clearDirectories())
  }, [dispatch])

  // 重置所有设置
  const resetSettings = useCallback(() => {
    dispatch(resetCodeTools())
  }, [dispatch])

  // 选择文件夹的辅助函数
  const selectFolder = useCallback(async () => {
    try {
      const folderPath = await window.api.file.selectFolder()
      if (folderPath) {
        await setCurrentDir(folderPath)
        return folderPath
      }
      return null
    } catch (error) {
      logger.error('选择文件夹失败:', error as Error)
      throw error
    }
  }, [setCurrentDir, logger])

  // 获取当前CLI工具选择的模型
  const selectedModel = codeToolsState.selectedModels[codeToolsState.selectedCliTool] || null

  // 获取当前CLI工具的环境变量
  const environmentVariables = codeToolsState?.environmentVariables?.[codeToolsState.selectedCliTool] || ''

  // 检查是否可以启动（所有必需字段都已填写）
  const canLaunch = Boolean(
    codeToolsState.selectedCliTool &&
      codeToolsState.currentDirectory &&
      (codeToolsState.selectedCliTool === codeTools.githubCopilotCli || selectedModel)
  )

  return {
    // 状态
    selectedCliTool: codeToolsState.selectedCliTool,
    selectedModel: selectedModel,
    selectedTerminal: codeToolsState.selectedTerminal,
    environmentVariables: environmentVariables,
    directories: codeToolsState.directories,
    currentDirectory: codeToolsState.currentDirectory,
    canLaunch,

    // 操作函数
    setCliTool,
    setModel,
    setTerminal,
    setEnvVars,
    addDir,
    removeDir,
    setCurrentDir,
    clearDirs,
    resetSettings,
    selectFolder
  }
}
