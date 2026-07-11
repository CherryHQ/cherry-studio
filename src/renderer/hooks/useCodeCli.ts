import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type {
  CliProviderConfig,
  CodeCliConfigs,
  CodeCliId,
  CodeCliToolState
} from '@shared/data/preference/preferenceTypes'
import { CLI_OWN_LOGIN_PROVIDER_ID, CodeCli } from '@shared/types/codeCli'
import { useCallback, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('useCodeCli')

const PREFERENCE_KEY = 'feature.code_cli.configs'
const DEFAULT_TOOL = CodeCli.CLAUDE_CODE

const EMPTY_TOOL_STATE: CodeCliToolState = { providers: {}, current: null }

function getToolState(toolId: CodeCliId, configs: CodeCliConfigs): CodeCliToolState {
  const state = configs[toolId] ?? EMPTY_TOOL_STATE
  // Dev profiles written before `modelId: UniqueModelId | null` may hold the
  // legacy '' sentinel; normalize on read (this is the preference's only read
  // choke point) so the next write self-heals. No migration needed.
  const legacyIds = Object.keys(state.providers).filter((id) => (state.providers[id].modelId as string) === '')
  if (legacyIds.length === 0) return state
  const providers = { ...state.providers }
  for (const id of legacyIds) {
    providers[id] = { ...providers[id], modelId: null }
  }
  return { ...state, providers }
}

export const useCodeCli = () => {
  const [configs, setConfigs] = usePreference(PREFERENCE_KEY)

  // Mirror configs in a ref so sequential writes read the freshest value.
  // A write queue serialises patchToolState calls so two concurrent writes
  // never clobber each other (setConfigs takes a plain value, not an updater).
  const configsRef = useRef(configs)
  configsRef.current = configs
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve())

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
    (toolId: CodeCliId, patch: (prev: CodeCliToolState) => CodeCliToolState): Promise<void> => {
      const task = writeQueueRef.current.then(async () => {
        const latest = configsRef.current
        const prev = getToolState(toolId, latest)
        const next = { ...latest, [toolId]: patch(prev) }
        configsRef.current = next
        await setConfigs(next)
      })
      writeQueueRef.current = task.catch(() => {})
      return task
    },
    [setConfigs]
  )

  const upsertProviderConfig = useCallback(
    async (
      providerId: string,
      partial: Pick<CliProviderConfig, 'modelId'> & Partial<CliProviderConfig>
    ): Promise<string> => {
      const toolId = selectedCliTool as CodeCliId
      const existing = getToolState(toolId, configsRef.current).providers[providerId]
      const next: CliProviderConfig = {
        modelId: partial.modelId,
        ...(partial.config || existing?.config ? { config: partial.config ?? existing?.config } : {}),
        ...(partial.sortIndex !== undefined || existing?.sortIndex !== undefined
          ? { sortIndex: partial.sortIndex ?? existing?.sortIndex }
          : {})
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
      await patchToolState(toolId, (prev) => {
        const nextProviders = { ...prev.providers }
        for (let i = 0; i < orderedIds.length; i++) {
          const id = orderedIds[i]
          const existing = nextProviders[id]
          if (!existing) {
            // The virtual own-login entry has no real config; persist a placeholder so its drag
            // position sticks. Real unconfigured providers are still skipped (no empty configs).
            if (id === CLI_OWN_LOGIN_PROVIDER_ID) {
              nextProviders[id] = { modelId: null, sortIndex: i }
            }
            continue
          }
          nextProviders[id] = { ...existing, sortIndex: i }
        }
        return { ...prev, providers: nextProviders }
      })
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
      await patchToolState(selectedCliTool as CodeCliId, (prev) => ({ ...prev, directory }))
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
    configs,
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
