import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type {
  CliProviderConfig,
  CodeCliConfigs,
  CodeCliId,
  CodeCliToolState
} from '@shared/data/preference/preferenceTypes'
import { CodeCli } from '@shared/types/codeCli'
import { useCallback, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('useCodeCli')

const PREFERENCE_KEY = 'feature.code_cli.configs'
const DEFAULT_TOOL = CodeCli.CLAUDE_CODE

const EMPTY_TOOL_STATE: CodeCliToolState = { providers: {}, current: null }

function getToolState(toolId: CodeCliId, configs: CodeCliConfigs): CodeCliToolState {
  return configs[toolId] ?? EMPTY_TOOL_STATE
}

export const useCodeCli = () => {
  const [configs, setConfigs] = usePreference(PREFERENCE_KEY)

  // Mirror configs in a ref so sequential writes chain correctly: usePreference's
  // setter takes a plain value, so two awaited writes back-to-back would otherwise
  // have the second read a stale snapshot and clobber the first.
  const configsRef = useRef(configs)
  configsRef.current = configs

  const [selectedCliTool, setSelectedCliTool] = useState<CodeCli>(DEFAULT_TOOL)

  const selectTool = useCallback((tool: CodeCli) => {
    setSelectedCliTool(tool)
  }, [])

  const currentToolState = useMemo(() => getToolState(selectedCliTool, configs), [selectedCliTool, configs])

  const currentProviderId = currentToolState.current
  const currentProviderConfig = useMemo(
    () => (currentProviderId ? (currentToolState.providers[currentProviderId] ?? null) : null),
    [currentToolState, currentProviderId]
  )
  const selectedTerminal = currentToolState.terminal
  const directory = currentToolState.directory
  const providerConfigs = currentToolState.providers

  const patchToolState = useCallback(
    async (toolId: CodeCliId, patch: (prev: CodeCliToolState) => CodeCliToolState) => {
      const latest = configsRef.current
      const prev = getToolState(toolId, latest)
      const next = { ...latest, [toolId]: patch(prev) }
      configsRef.current = next
      await setConfigs(next)
    },
    [setConfigs]
  )

  const upsertProviderConfig = useCallback(
    async (
      providerId: string,
      partial: Pick<CliProviderConfig, 'modelId'> & Partial<CliProviderConfig>
    ): Promise<string> => {
      const toolId = selectedCliTool as CodeCliId
      const now = Date.now()
      const existing = getToolState(toolId, configsRef.current).providers[providerId]
      const next: CliProviderConfig = {
        modelId: partial.modelId,
        ...(partial.config || existing?.config ? { config: partial.config ?? existing?.config } : {}),
        createdAt: existing?.createdAt ?? now
      }
      await patchToolState(toolId, (prev) => ({
        ...prev,
        providers: { ...prev.providers, [providerId]: next }
      }))
      logger.info('Upserted CLI provider config', { toolId, providerId })
      return providerId
    },
    [patchToolState, selectedCliTool]
  )

  const deleteProviderConfig = useCallback(
    async (providerId: string) => {
      const toolId = selectedCliTool as CodeCliId
      await patchToolState(toolId, (prev) => {
        const nextProviders = { ...prev.providers }
        delete nextProviders[providerId]
        return {
          ...prev,
          providers: nextProviders,
          current: prev.current === providerId ? null : prev.current
        }
      })
    },
    [patchToolState, selectedCliTool]
  )

  const setCurrentProvider = useCallback(
    async (providerId: string | null) => {
      const toolId = selectedCliTool as CodeCliId
      await patchToolState(toolId, (prev) => ({ ...prev, current: providerId }))
    },
    [patchToolState, selectedCliTool]
  )

  const reorderProviders = useCallback(
    async (orderedIds: string[]) => {
      const toolId = selectedCliTool as CodeCliId
      await patchToolState(toolId, (prev) => ({ ...prev, providerOrder: orderedIds }))
    },
    [patchToolState, selectedCliTool]
  )

  const setTerminal = useCallback(
    async (terminal: string) => {
      await patchToolState(selectedCliTool as CodeCliId, (prev) => ({ ...prev, terminal }))
    },
    [patchToolState, selectedCliTool]
  )

  const setDirectory = useCallback(
    async (directory: string) => {
      const toolId = selectedCliTool as CodeCliId
      await patchToolState(toolId, (prev) => {
        const currentDirs = prev.directories ?? []
        let newDirs: string[]
        if (directory && !currentDirs.includes(directory)) {
          newDirs = [directory, ...currentDirs].slice(0, 10)
        } else if (directory && currentDirs.includes(directory)) {
          newDirs = [directory, ...currentDirs.filter((d) => d !== directory)]
        } else {
          newDirs = currentDirs
        }
        return { ...prev, directory, directories: newDirs }
      })
    },
    [patchToolState, selectedCliTool]
  )

  const selectFolder = useCallback(async (): Promise<string | null> => {
    try {
      const folderPath = await window.api.file.selectFolder()
      if (folderPath) {
        await setDirectory(folderPath)
        return folderPath
      }
      return null
    } catch (error) {
      logger.error('Failed to select folder:', error as Error)
      throw error
    }
  }, [setDirectory])

  return {
    selectedCliTool,
    currentToolState,
    currentProviderId,
    currentProviderConfig,
    providerConfigs,
    directory,
    selectedTerminal,
    upsertProviderConfig,
    deleteProviderConfig,
    setCurrentProvider,
    reorderProviders,
    selectTool,
    setTerminal,
    setDirectory,
    selectFolder
  }
}
