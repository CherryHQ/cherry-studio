import { loggerService } from '@renderer/services/LoggerService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addDirectory,
  clearDirectories,
  removeDirectory,
  resetCodeTools,
  setCurrentDirectory,
  setSelectedCliTool,
  setSelectedModel
} from '@renderer/store/codeTools'
import { Model } from '@renderer/types'
import { useCallback } from 'react'

export const useCodeTools = () => {
  const dispatch = useAppDispatch()
  const codeToolsState = useAppSelector((state) => state.codeTools)
  const logger = loggerService.withContext('useCodeTools')

  // 设置选择的 CLI 工具
  const setCliTool = useCallback(
    (tool: string) => {
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

  // 设置当前目录
  const setCurrentDir = useCallback(
    (directory: string) => {
      dispatch(setCurrentDirectory(directory))
    },
    [dispatch]
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
        setCurrentDir(folderPath)
        return folderPath
      }
      return null
    } catch (error) {
      logger.error('选择文件夹失败:', error as Error)
      throw error
    }
  }, [setCurrentDir, logger])

  // 检查是否可以启动（所有必需字段都已填写）
  const canLaunch = Boolean(
    codeToolsState.selectedCliTool && codeToolsState.selectedModel && codeToolsState.currentDirectory
  )

  return {
    // 状态
    selectedCliTool: codeToolsState.selectedCliTool,
    selectedModel: codeToolsState.selectedModel,
    directories: codeToolsState.directories,
    currentDirectory: codeToolsState.currentDirectory,
    canLaunch,

    // 操作函数
    setCliTool,
    setModel,
    addDir,
    removeDir,
    setCurrentDir,
    clearDirs,
    resetSettings,
    selectFolder
  }
}
