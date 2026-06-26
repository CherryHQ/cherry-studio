import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type {
  CliNamedConfig,
  CodeCliConfigs,
  CodeCliId,
  CodeCliToolState
} from '@shared/data/preference/preferenceTypes'
import { codeCLI } from '@shared/types/codeCli'
import { useCallback, useMemo, useState } from 'react'

const logger = loggerService.withContext('useCodeCli')

const PREFERENCE_KEY = 'feature.code_cli.configs'
const DEFAULT_TOOL = codeCLI.claudeCode as CodeCliId

const EMPTY_TOOL_STATE: CodeCliToolState = { providers: {}, current: null }

function getToolState(toolId: CodeCliId, configs: CodeCliConfigs): CodeCliToolState {
  return configs[toolId] ?? EMPTY_TOOL_STATE
}

/** Generate a short unique client id (timestamp + random). */
function generateConfigId(): string {
  return `cfg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Ordered list of configs for a tool (sorted by sortIndex then insertion). */
function orderedConfigs(state: CodeCliToolState): CliNamedConfig[] {
  const entries = Object.values(state.providers)
  return entries.sort((a, b) => {
    const ai = a.sortIndex ?? 0
    const bi = b.sortIndex ?? 0
    if (ai !== bi) return ai - bi
    return (a.createdAt ?? 0) - (b.createdAt ?? 0)
  })
}

export const useCodeCli = () => {
  const [configs, setConfigs] = usePreference(PREFERENCE_KEY)

  const [selectedCliTool, setSelectedCliTool] = useState<codeCLI>(DEFAULT_TOOL)

  const selectTool = useCallback((tool: codeCLI) => {
    setSelectedCliTool(tool)
  }, [])

  const currentToolState = useMemo(() => getToolState(selectedCliTool, configs), [selectedCliTool, configs])

  const orderedList = useMemo(() => orderedConfigs(currentToolState), [currentToolState])

  const currentConfig = useMemo(
    () => (currentToolState.current ? (currentToolState.providers[currentToolState.current] ?? null) : null),
    [currentToolState]
  )

  const selectedModel = currentConfig?.modelId ?? null
  const selectedTerminal = currentToolState.terminal
  const directories = currentToolState.directories ?? []

  const canLaunch = Boolean(currentConfig?.modelId && currentConfig?.directory)

  /** Patch a single tool's state. */
  const patchToolState = useCallback(
    async (toolId: CodeCliId, patch: (prev: CodeCliToolState) => CodeCliToolState) => {
      await setConfigs((prevConfigs: CodeCliConfigs) => {
        const prev = getToolState(toolId, prevConfigs)
        return { ...prevConfigs, [toolId]: patch(prev) }
      })
    },
    [setConfigs]
  )

  /** Add a new named config for a tool. Returns the new config id. */
  const addConfig = useCallback(
    async (
      toolId: CodeCliId,
      partial: Pick<CliNamedConfig, 'name' | 'providerId' | 'modelId'> & Partial<CliNamedConfig>
    ): Promise<string> => {
      const id = generateConfigId()
      const now = Date.now()
      const orderLen = orderedConfigs(getToolState(toolId, configs)).length
      const config: CliNamedConfig = {
        id,
        name: partial.name,
        providerId: partial.providerId,
        modelId: partial.modelId,
        createdAt: now,
        sortIndex: orderLen,
        ...(partial.advanced ? { advanced: partial.advanced } : {}),
        ...(partial.directory ? { directory: partial.directory } : {}),
        ...(partial.notes ? { notes: partial.notes } : {}),
        ...(partial.icon ? { icon: partial.icon } : {}),
        ...(partial.iconColor ? { iconColor: partial.iconColor } : {})
      }
      await patchToolState(toolId, (prev) => ({
        ...prev,
        providers: { ...prev.providers, [id]: config }
      }))
      logger.info('Added CLI config', { toolId, configId: id })
      return id
    },
    [configs, patchToolState]
  )

  /** Update an existing named config (by id) for a tool. */
  const updateConfig = useCallback(
    async (toolId: CodeCliId, configId: string, patch: Partial<CliNamedConfig>) => {
      await patchToolState(toolId, (prev) => {
        const existing = prev.providers[configId]
        if (!existing) return prev
        return { ...prev, providers: { ...prev.providers, [configId]: { ...existing, ...patch } } }
      })
    },
    [patchToolState]
  )

  /** Duplicate an existing config under a new id. */
  const duplicateConfig = useCallback(
    async (toolId: CodeCliId, configId: string): Promise<string | null> => {
      const existing = getToolState(toolId, configs).providers[configId]
      if (!existing) return null
      const id = generateConfigId()
      const orderLen = orderedConfigs(getToolState(toolId, configs)).length
      const copy: CliNamedConfig = {
        ...existing,
        id,
        name: `${existing.name} copy`,
        createdAt: Date.now(),
        sortIndex: orderLen
      }
      await patchToolState(toolId, (prev) => ({
        ...prev,
        providers: { ...prev.providers, [id]: copy }
      }))
      logger.info('Duplicated CLI config', { toolId, from: configId, to: id })
      return id
    },
    [configs, patchToolState]
  )

  /** Delete a named config; clears `current` if it was active. */
  const deleteConfig = useCallback(
    async (toolId: CodeCliId, configId: string) => {
      await patchToolState(toolId, (prev) => {
        const nextProviders = { ...prev.providers }
        delete nextProviders[configId]
        return {
          ...prev,
          providers: nextProviders,
          current: prev.current === configId ? null : prev.current
        }
      })
    },
    [patchToolState]
  )

  /** Set the tool's active config. */
  const setCurrentConfig = useCallback(
    async (toolId: CodeCliId, configId: string) => {
      await patchToolState(toolId, (prev) => ({ ...prev, current: configId }))
    },
    [patchToolState]
  )

  /** Reorder configs by id list (drag-to-reorder). */
  const reorderConfigs = useCallback(
    async (toolId: CodeCliId, orderedIds: string[]) => {
      await patchToolState(toolId, (prev) => {
        const nextProviders: Record<string, CliNamedConfig> = {}
        orderedIds.forEach((id, index) => {
          const existing = prev.providers[id]
          if (existing) nextProviders[id] = { ...existing, sortIndex: index }
        })
        const remainder = orderedConfigs(prev)
          .filter((c) => !orderedIds.includes(c.id))
          .map((c, i) => ({ ...c, sortIndex: orderedIds.length + i }))
        for (const c of remainder) nextProviders[c.id] = c
        return { ...prev, providers: nextProviders }
      })
    },
    [patchToolState]
  )

  /** Set the tool-level terminal (shared across the tool's configs). */
  const setTerminal = useCallback(
    async (terminal: string) => {
      await patchToolState(selectedCliTool as CodeCliId, (prev) => ({ ...prev, terminal }))
    },
    [patchToolState, selectedCliTool]
  )

  /** Set a config's working directory and refresh the tool-level MRU list. */
  const setDirectory = useCallback(
    async (configId: string, directory: string) => {
      const toolId = selectedCliTool as CodeCliId
      const state = getToolState(toolId, configs)
      const currentDirs = state.directories ?? []
      let newDirs: string[]
      if (directory && !currentDirs.includes(directory)) {
        newDirs = [directory, ...currentDirs].slice(0, 10)
      } else if (directory && currentDirs.includes(directory)) {
        newDirs = [directory, ...currentDirs.filter((d) => d !== directory)]
      } else {
        newDirs = currentDirs
      }
      await patchToolState(toolId, (prev) => ({
        ...prev,
        directories: newDirs,
        providers: prev.providers[configId]
          ? { ...prev.providers, [configId]: { ...prev.providers[configId], directory } }
          : prev.providers
      }))
    },
    [configs, patchToolState, selectedCliTool]
  )

  /** Pick a folder via native dialog and assign it to the given config. */
  const selectFolder = useCallback(
    async (configId: string): Promise<string | null> => {
      try {
        const folderPath = await window.api.file.selectFolder()
        if (folderPath) {
          await setDirectory(configId, folderPath)
          return folderPath
        }
        return null
      } catch (error) {
        logger.error('Failed to select folder:', error as Error)
        throw error
      }
    },
    [setDirectory]
  )

  const removeDir = useCallback(
    async (directory: string) => {
      await patchToolState(selectedCliTool as CodeCliId, (prev) => {
        const currentDirs = prev.directories ?? []
        const newDirs = currentDirs.filter((d) => d !== directory)
        return { ...prev, directories: newDirs }
      })
    },
    [patchToolState, selectedCliTool]
  )

  return {
    selectedCliTool,
    configs,
    currentToolState,
    orderedList,
    currentConfig,
    selectedModel,
    selectedTerminal,
    directories,
    canLaunch,
    // config CRUD
    addConfig,
    updateConfig,
    duplicateConfig,
    deleteConfig,
    setCurrentConfig,
    reorderConfigs,
    // tool-level
    selectTool,
    setTerminal,
    setDirectory,
    selectFolder,
    removeDir
  }
}
