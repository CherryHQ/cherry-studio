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
import { useCallback, useRef } from 'react'

export const useCodeTools = () => {
  const dispatch = useAppDispatch()
  const codeToolsState = useAppSelector((state) => state.codeTools)
  const logger = loggerService.withContext('useCodeTools')

  // 使用 ref 来跟踪每个 CLI 工具是否已经被初始化过
  const initializedTools = useRef<Set<string>>(new Set())

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
    // 重置初始化状态
    initializedTools.current.clear()
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

  // 获取当前CLI工具选择的模型
  const selectedModel = codeToolsState.selectedModels[codeToolsState.selectedCliTool] || null

  // 检查是否可以启动（所有必需字段都已填写）
  const canLaunch = Boolean(codeToolsState.selectedCliTool && selectedModel && codeToolsState.currentDirectory)

/*   // 自动设置默认模型：只在首次选择CLI工具时（模型为null且未初始化过）才设置默认模型
  useEffect(() => {
    const currentTool = codeToolsState.selectedCliTool
    const currentToolModel = codeToolsState.selectedModels[currentTool]
    
    // 只有当模型为null且该工具未被初始化过时，才自动设置默认模型
    if (!currentToolModel && !initializedTools.current.has(currentTool)) {
      // 查找智谱提供商中的 GLM-4.5-Flash 模型
      const zhipuProvider = providers.find((p) => p.id === 'zhipu')
      if (zhipuProvider) {
        const glm45FlashModel = zhipuProvider.models.find((m) => m.id === 'glm-4.5-flash')
        if (glm45FlashModel) {
          logger.debug(`为CLI工具 ${currentTool} 首次设置默认模型 GLM-4.5-Flash`)
          setModel(glm45FlashModel)
          // 标记该工具已初始化
          initializedTools.current.add(currentTool)
        }
      }
    } else if (currentToolModel) {
      // 如果用户选择了模型，标记该工具已初始化（防止后续自动设置）
      initializedTools.current.add(currentTool)
    }
  }, [codeToolsState.selectedCliTool, providers, setModel, logger]) */

  return {
    // 状态
    selectedCliTool: codeToolsState.selectedCliTool,
    selectedModel: selectedModel,
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
