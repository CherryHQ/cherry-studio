import type { ComposerToolLauncher } from '@renderer/components/chat/composer/toolLauncher'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { ensureComposerFileTokenSourceIds } from '@renderer/utils/message/composerFileTokenSource'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { Model } from '@shared/data/types/model'
import React, { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Read-only state interface for Composer tools.
 * Components subscribing to this state will re-render on changes.
 */
export interface ComposerToolState {
  /** Attached files */
  files: ComposerAttachment[]
  /** Models selected by the composer model selector for the current send */
  mentionedModels: Model[]
  /** Selected knowledge base items */
  selectedKnowledgeBases: KnowledgeBase[]
  /** Whether the composer is expanded */
  isExpanded: boolean

  /** Whether image files can be added (derived state) */
  couldAddImageFile: boolean
  /** Supported file extensions (derived state) */
  extensions: string[]
  /** Knowledge bases that are configured-and-available for the current scope (derived state) */
  selectableKnowledgeBases: KnowledgeBase[]
}

/**
 * Tools registry API for tool buttons.
 * Used to register composer launchers.
 */
export interface ComposerToolsRegistryApi {
  registerLaunchers: (toolKey: string, entries: ComposerToolLauncher[]) => () => void
}

/**
 * Composer launcher API.
 */
export interface ComposerToolLaunchersApi {
  getLaunchers: () => ComposerToolLauncher[]
  version: number
}

/**
 * Dispatch interface containing all action functions.
 * These functions have stable references and won't cause re-renders.
 */
export interface ComposerToolDispatch {
  /** State setters */
  setFiles: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>
  setMentionedModels: React.Dispatch<React.SetStateAction<Model[]>>
  setSelectedKnowledgeBases: React.Dispatch<React.SetStateAction<KnowledgeBase[]>>
  setIsExpanded: React.Dispatch<React.SetStateAction<boolean>>

  /** Parent component actions */
  addNewTopic: () => void

  /** Text manipulation (avoids putting text state in Context) */
  onTextChange: (updater: string | ((prev: string) => string)) => void

  /** Tools registry API (for tool buttons) */
  toolsRegistry: ComposerToolsRegistryApi

  /** Launcher API (for Composer component) */
  triggers: ComposerToolLaunchersApi
}

const ComposerToolStateContext = createContext<ComposerToolState | undefined>(undefined)
const ComposerToolDispatchContext = createContext<ComposerToolDispatch | undefined>(undefined)
const ComposerToolLaunchersContext = createContext<ComposerToolLaunchersApi | undefined>(undefined)
const EMPTY_EXTENSIONS: string[] = []
const EMPTY_KNOWLEDGE_BASES: KnowledgeBase[] = []

/**
 * Get Composer tool state (read-only).
 * Components using this hook will re-render when state changes.
 */
export const useComposerToolProviderState = (): ComposerToolState => {
  const context = use(ComposerToolStateContext)
  if (!context) {
    throw new Error('useComposerToolProviderState must be used within ComposerToolProvider')
  }
  return context
}

/**
 * Get Composer tool dispatch functions (stable references).
 * Components using this hook won't re-render when state changes.
 */
export const useComposerToolProviderDispatch = (): ComposerToolDispatch => {
  const context = use(ComposerToolDispatchContext)
  if (!context) {
    throw new Error('useComposerToolProviderDispatch must be used within ComposerToolProvider')
  }
  return context
}

export const useComposerToolProviderLaunchers = (): ComposerToolLaunchersApi => {
  const context = use(ComposerToolLaunchersContext)
  if (!context) {
    throw new Error('useComposerToolProviderLaunchers must be used within ComposerToolProvider')
  }
  return context
}

/**
 * Combined type containing both state and dispatch.
 * Used for type inference in tool buttons.
 */
export type ComposerToolContextValue = ComposerToolState & ComposerToolDispatch

interface ComposerToolProviderProps {
  children: React.ReactNode
  initialState?: Partial<{
    files: ComposerAttachment[]
    mentionedModels: Model[]
    selectedKnowledgeBases: KnowledgeBase[]
    isExpanded: boolean
    couldAddImageFile: boolean
    extensions: string[]
    selectableKnowledgeBases: KnowledgeBase[]
  }>
  actions: {
    addNewTopic: () => void
    onTextChange: (updater: string | ((prev: string) => string)) => void
  }
}

export const ComposerToolProvider: React.FC<ComposerToolProviderProps> = ({ children, initialState, actions }) => {
  // Core state
  const [files, setComposerFiles] = useState<ComposerAttachment[]>(() =>
    ensureComposerFileTokenSourceIds(initialState?.files || [])
  )
  const [mentionedModels, setMentionedModels] = useState<Model[]>(initialState?.mentionedModels || [])
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<KnowledgeBase[]>(
    initialState?.selectedKnowledgeBases || []
  )
  const [isExpanded, setIsExpanded] = useState(initialState?.isExpanded || false)

  const couldAddImageFile = initialState?.couldAddImageFile ?? false
  const extensions = initialState?.extensions ?? EMPTY_EXTENSIONS
  const selectableKnowledgeBases = initialState?.selectableKnowledgeBases ?? EMPTY_KNOWLEDGE_BASES

  // Composer launcher registry (stored in refs to avoid re-renders)
  const launcherRegistryRef = useRef(new Map<string, ComposerToolLauncher[]>())
  const [launcherVersion, setLauncherVersion] = useState(0)
  const launcherVersionRef = useRef(launcherVersion)
  launcherVersionRef.current = launcherVersion

  const getComposerToolLaunchers = useCallback(() => {
    const allEntries: ComposerToolLauncher[] = []
    launcherRegistryRef.current.forEach((entries) => {
      allEntries.push(...entries)
    })
    return allEntries
  }, [])

  const registerLaunchers = useCallback((toolKey: string, entries: ComposerToolLauncher[]) => {
    launcherRegistryRef.current.set(toolKey, entries)
    setLauncherVersion((version) => version + 1)
    return () => {
      launcherRegistryRef.current.delete(toolKey)
      setLauncherVersion((version) => version + 1)
    }
  }, [])

  // Stabilize parent actions (prevent dispatch context updates from parent action reference changes)
  const actionsRef = useRef(actions)
  useEffect(() => {
    actionsRef.current = actions
  }, [actions])

  const stableActions = useMemo(
    () => ({
      addNewTopic: () => actionsRef.current.addNewTopic(),
      onTextChange: (updater: string | ((prev: string) => string)) => actionsRef.current.onTextChange(updater)
    }),
    []
  )

  const setFiles = useCallback<React.Dispatch<React.SetStateAction<ComposerAttachment[]>>>((nextFiles) => {
    setComposerFiles((previousFiles) =>
      ensureComposerFileTokenSourceIds(typeof nextFiles === 'function' ? nextFiles(previousFiles) : nextFiles)
    )
  }, [])

  // State Context Value (updates when state changes)
  const stateValue = useMemo<ComposerToolState>(
    () => ({
      files,
      mentionedModels,
      selectedKnowledgeBases,
      isExpanded,
      couldAddImageFile,
      extensions,
      selectableKnowledgeBases
    }),
    [
      files,
      mentionedModels,
      selectedKnowledgeBases,
      isExpanded,
      couldAddImageFile,
      extensions,
      selectableKnowledgeBases
    ]
  )

  // Tools Registry API (stable references for tool buttons)
  const toolsRegistryApi = useMemo<ComposerToolsRegistryApi>(
    () => ({
      registerLaunchers
    }),
    [registerLaunchers]
  )

  // Launcher API (stable references for Composer component)
  const triggersApi = useMemo<ComposerToolLaunchersApi>(
    () => ({
      getLaunchers: getComposerToolLaunchers,
      version: launcherVersion
    }),
    [getComposerToolLaunchers, launcherVersion]
  )

  const stableTriggersApi = useMemo<ComposerToolLaunchersApi>(
    () => ({
      getLaunchers: getComposerToolLaunchers,
      get version() {
        return launcherVersionRef.current
      }
    }),
    [getComposerToolLaunchers]
  )

  // Dispatch Context Value (stable references)
  const dispatchValue = useMemo<ComposerToolDispatch>(
    () => ({
      // State setters (React guarantees stable references)
      setFiles,
      setMentionedModels,
      setSelectedKnowledgeBases,
      setIsExpanded,

      // Stable actions
      ...stableActions,

      // API objects
      toolsRegistry: toolsRegistryApi,
      triggers: stableTriggersApi
    }),
    [setFiles, stableActions, toolsRegistryApi, stableTriggersApi]
  )

  return (
    <ComposerToolStateContext value={stateValue}>
      <ComposerToolDispatchContext value={dispatchValue}>
        <ComposerToolLaunchersContext value={triggersApi}>{children}</ComposerToolLaunchersContext>
      </ComposerToolDispatchContext>
    </ComposerToolStateContext>
  )
}

interface ComposerToolDerivedStateProviderProps {
  children: React.ReactNode
  couldAddImageFile: boolean
  extensions: string[]
  selectableKnowledgeBases?: KnowledgeBase[]
}

export const ComposerToolDerivedStateProvider: React.FC<ComposerToolDerivedStateProviderProps> = ({
  children,
  couldAddImageFile,
  extensions,
  selectableKnowledgeBases
}) => {
  const state = useComposerToolProviderState()
  const stateValue = useMemo<ComposerToolState>(
    () => ({
      ...state,
      couldAddImageFile,
      extensions,
      selectableKnowledgeBases: selectableKnowledgeBases ?? state.selectableKnowledgeBases
    }),
    [couldAddImageFile, extensions, selectableKnowledgeBases, state]
  )

  return <ComposerToolStateContext value={stateValue}>{children}</ComposerToolStateContext>
}
