import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { codeCLI } from '@shared/config/constant'
import type { CodeCliId, CodeCliOverride, CodeCliOverrides } from '@shared/data/preference/preferenceTypes'
import { CODE_CLI_PRESET_MAP } from '@shared/data/presets/code-cli'
import { useCallback, useMemo } from 'react'

const logger = loggerService.withContext('useCodeCli')

const DEFAULT_TOOL = codeCLI.qwenCode as CodeCliId

function getEffectiveToolConfig(toolId: CodeCliId, overrides: CodeCliOverrides): Required<CodeCliOverride> {
  const preset = CODE_CLI_PRESET_MAP[toolId]
  const override = overrides[toolId] ?? {}
  return {
    enabled: override.enabled ?? preset.enabled,
    modelId: override.modelId ?? preset.modelId,
    envVars: override.envVars ?? preset.envVars,
    terminal: override.terminal ?? preset.terminal,
    currentDirectory: override.currentDirectory ?? preset.currentDirectory,
    directories: override.directories ?? [...preset.directories]
  }
}

export const useCodeCli = () => {
  const [overrides, setOverrides] = usePreference('feature.code_cli.overrides')

  const selectedCliTool = useMemo(() => {
    for (const [toolId, override] of Object.entries(overrides)) {
      if (override?.enabled) {
        return toolId as codeCLI
      }
    }
    return DEFAULT_TOOL as codeCLI
  }, [overrides])

  const currentConfig = useMemo(
    () => getEffectiveToolConfig(selectedCliTool as CodeCliId, overrides),
    [selectedCliTool, overrides]
  )

  const selectedModel = currentConfig.modelId
  const selectedTerminal = currentConfig.terminal
  const environmentVariables = currentConfig.envVars
  const directories = currentConfig.directories
  const currentDirectory = currentConfig.currentDirectory

  const canLaunch = Boolean(
    selectedCliTool && currentDirectory && (selectedCliTool === codeCLI.githubCopilotCli || selectedModel)
  )

  const updateCurrentTool = useCallback(
    async (patch: Partial<CodeCliOverride>) => {
      const toolId = selectedCliTool as CodeCliId
      const existing = overrides[toolId] ?? {}
      await setOverrides({
        ...overrides,
        [toolId]: { ...existing, ...patch }
      })
    },
    [overrides, setOverrides, selectedCliTool]
  )

  const setCliTool = useCallback(
    async (tool: codeCLI) => {
      const newOverrides = { ...overrides }
      const currentId = selectedCliTool as CodeCliId
      if (newOverrides[currentId]) {
        newOverrides[currentId] = { ...newOverrides[currentId], enabled: false }
      }
      const newId = tool as CodeCliId
      newOverrides[newId] = { ...newOverrides[newId], enabled: true }
      await setOverrides(newOverrides)
    },
    [overrides, setOverrides, selectedCliTool]
  )

  const setModel = useCallback(
    async (modelId: string | null) => {
      await updateCurrentTool({ modelId })
    },
    [updateCurrentTool]
  )

  const setTerminal = useCallback(
    async (terminal: string) => {
      await updateCurrentTool({ terminal })
    },
    [updateCurrentTool]
  )

  const setEnvVars = useCallback(
    async (envVars: string) => {
      await updateCurrentTool({ envVars })
    },
    [updateCurrentTool]
  )

  const setCurrentDir = useCallback(
    async (directory: string) => {
      const toolId = selectedCliTool as CodeCliId
      const existing = overrides[toolId] ?? {}
      const currentDirs = existing.directories ?? []
      let newDirs: string[]
      if (directory && !currentDirs.includes(directory)) {
        newDirs = [directory, ...currentDirs].slice(0, 10)
      } else if (directory && currentDirs.includes(directory)) {
        newDirs = [directory, ...currentDirs.filter((d) => d !== directory)]
      } else {
        newDirs = currentDirs
      }
      await setOverrides({
        ...overrides,
        [toolId]: { ...existing, currentDirectory: directory, directories: newDirs }
      })
    },
    [overrides, setOverrides, selectedCliTool]
  )

  const removeDir = useCallback(
    async (directory: string) => {
      const toolId = selectedCliTool as CodeCliId
      const existing = overrides[toolId] ?? {}
      const currentDirs = existing.directories ?? []
      const newDirs = currentDirs.filter((d) => d !== directory)
      const patch: Partial<CodeCliOverride> = { directories: newDirs }
      if (existing.currentDirectory === directory) {
        patch.currentDirectory = ''
      }
      await setOverrides({
        ...overrides,
        [toolId]: { ...existing, ...patch }
      })
    },
    [overrides, setOverrides, selectedCliTool]
  )

  const clearDirs = useCallback(async () => {
    await updateCurrentTool({ directories: [], currentDirectory: '' })
  }, [updateCurrentTool])

  const resetSettings = useCallback(async () => {
    await setOverrides({})
  }, [setOverrides])

  const selectFolder = useCallback(async () => {
    try {
      const folderPath = await window.api.file.selectFolder()
      if (folderPath) {
        await setCurrentDir(folderPath)
        return folderPath
      }
      return null
    } catch (error) {
      logger.error('Failed to select folder:', error as Error)
      throw error
    }
  }, [setCurrentDir])

  return {
    selectedCliTool,
    selectedModel,
    selectedTerminal,
    environmentVariables,
    directories,
    currentDirectory,
    canLaunch,
    setCliTool,
    setModel,
    setTerminal,
    setEnvVars,
    setCurrentDir,
    removeDir,
    clearDirs,
    resetSettings,
    selectFolder
  }
}
