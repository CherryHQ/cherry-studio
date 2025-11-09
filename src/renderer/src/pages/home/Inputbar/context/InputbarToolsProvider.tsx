import type { QuickPanelListItem, QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
import type { FileType, KnowledgeBase, Model } from '@renderer/types'
import { FileTypes } from '@renderer/types'
import React, { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'

type QuickPanelTriggerHandler = (payload?: unknown) => void

/**
 * Read-only state interface for Inputbar tools.
 * Components subscribing to this state will re-render on changes.
 */
export interface InputbarToolsState {
  /** Attached files */
  files: FileType[]
  /** Models mentioned in the input */
  mentionedModels: Model[]
  /** Selected knowledge base items */
  selectedKnowledgeBases: KnowledgeBase[]
  /** Whether the inputbar is expanded */
  isExpanded: boolean

  /** Whether image files can be added (derived state) */
  couldAddImageFile: boolean
  /** Whether non-vision models can be mentioned (derived state) */
  couldMentionNotVisionModel: boolean
  /** Supported file extensions (derived state) */
  extensions: string[]
}

/**
 * Tools registry API for tool buttons.
 * Used to register menu items and triggers.
 */
export interface ToolsRegistryAPI {
  /**
   * Register a tool to the root menu (triggered by `/`).
   * @param toolKey - Unique tool identifier
   * @param entries - Menu items to register
   * @returns Cleanup function to unregister
   */
  registerRootMenu: (toolKey: string, entries: QuickPanelListItem[]) => () => void

  /**
   * Register a trigger handler function.
   * @param toolKey - Unique tool identifier
   * @param symbol - Trigger symbol (e.g., @, #, /)
   * @param handler - Handler function to execute on trigger
   * @returns Cleanup function to unregister
   */
  registerTrigger: (toolKey: string, symbol: QuickPanelReservedSymbol, handler: QuickPanelTriggerHandler) => () => void
}

/**
 * Triggers API for Inputbar component.
 * Used to trigger panels and retrieve menu items.
 */
export interface TriggersAPI {
  /**
   * Emit a trigger for the specified symbol.
   * @param symbol - Trigger symbol
   * @param payload - Data to pass to trigger handlers
   */
  emit: (symbol: QuickPanelReservedSymbol, payload?: unknown) => void

  /**
   * Get all root menu items (merged from all registered tools).
   * @returns Merged menu items list
   */
  getRootMenu: () => QuickPanelListItem[]
}

/**
 * Dispatch interface containing all action functions.
 * These functions have stable references and won't cause re-renders.
 */
export interface InputbarToolsDispatch {
  /** State setters */
  setFiles: React.Dispatch<React.SetStateAction<FileType[]>>
  setMentionedModels: React.Dispatch<React.SetStateAction<Model[]>>
  setSelectedKnowledgeBases: React.Dispatch<React.SetStateAction<KnowledgeBase[]>>
  setIsExpanded: React.Dispatch<React.SetStateAction<boolean>>

  /** Parent component actions */
  resizeTextArea: () => void
  addNewTopic: () => void
  clearTopic: () => void
  onNewContext: () => void
  toggleExpanded: (nextState?: boolean) => void

  /** Text manipulation (avoids putting text state in Context) */
  onTextChange: (updater: string | ((prev: string) => string)) => void

  /** Tools registry API (for tool buttons) */
  toolsRegistry: ToolsRegistryAPI

  /** Triggers API (for Inputbar component) */
  triggers: TriggersAPI
}

const InputbarToolsStateContext = createContext<InputbarToolsState | undefined>(undefined)
const InputbarToolsDispatchContext = createContext<InputbarToolsDispatch | undefined>(undefined)

/**
 * Get Inputbar Tools state (read-only).
 * Components using this hook will re-render when state changes.
 */
export const useInputbarToolsState = (): InputbarToolsState => {
  const context = use(InputbarToolsStateContext)
  if (!context) {
    throw new Error('useInputbarToolsState must be used within InputbarToolsProvider')
  }
  return context
}

/**
 * Get Inputbar Tools dispatch functions (stable references).
 * Components using this hook won't re-render when state changes.
 */
export const useInputbarToolsDispatch = (): InputbarToolsDispatch => {
  const context = use(InputbarToolsDispatchContext)
  if (!context) {
    throw new Error('useInputbarToolsDispatch must be used within InputbarToolsProvider')
  }
  return context
}

/**
 * Combined type containing both state and dispatch.
 * Used for type inference in tool buttons.
 */
export type InputbarToolsContextValue = InputbarToolsState & InputbarToolsDispatch

/**
 * Get both state and dispatch (convenience hook).
 * Components using this hook will re-render when state changes.
 */
export const useInputbarTools = (): InputbarToolsContextValue => {
  const state = useInputbarToolsState()
  const dispatch = useInputbarToolsDispatch()
  return { ...state, ...dispatch }
}

interface InputbarToolsProviderProps {
  children: React.ReactNode
  initialState?: Partial<{
    files: FileType[]
    mentionedModels: Model[]
    selectedKnowledgeBases: KnowledgeBase[]
    isExpanded: boolean
    couldAddImageFile: boolean
    extensions: string[]
  }>
  actions: {
    resizeTextArea: () => void
    addNewTopic: () => void
    clearTopic: () => void
    onNewContext: () => void
    onTextChange: (updater: string | ((prev: string) => string)) => void
    toggleExpanded: (nextState?: boolean) => void
  }
}

export const InputbarToolsProvider: React.FC<InputbarToolsProviderProps> = ({ children, initialState, actions }) => {
  // Core state
  const [files, setFiles] = useState<FileType[]>(initialState?.files || [])
  const [mentionedModels, setMentionedModels] = useState<Model[]>(initialState?.mentionedModels || [])
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<KnowledgeBase[]>(
    initialState?.selectedKnowledgeBases || []
  )
  const [isExpanded, setIsExpanded] = useState(initialState?.isExpanded || false)

  // Derived state (internal management)
  const [couldAddImageFile, setCouldAddImageFile] = useState(initialState?.couldAddImageFile || false)
  const [extensions, setExtensions] = useState<string[]>(initialState?.extensions || [])

  const couldMentionNotVisionModel = !files.some((file) => file.type === FileTypes.IMAGE)

  // Quick Panel Registry (stored in refs to avoid re-renders)
  const rootMenuRegistryRef = useRef(new Map<string, QuickPanelListItem[]>())
  const triggerRegistryRef = useRef(new Map<QuickPanelReservedSymbol, Map<string, QuickPanelTriggerHandler>>())

  // Quick Panel API (stable references)
  const getQuickPanelRootMenu = useCallback(() => {
    const allEntries: QuickPanelListItem[] = []
    rootMenuRegistryRef.current.forEach((entries) => {
      allEntries.push(...entries)
    })
    return allEntries
  }, [])

  const registerRootMenu = useCallback((toolKey: string, entries: QuickPanelListItem[]) => {
    rootMenuRegistryRef.current.set(toolKey, entries)
    return () => {
      rootMenuRegistryRef.current.delete(toolKey)
    }
  }, [])

  const registerTrigger = useCallback(
    (toolKey: string, symbol: QuickPanelReservedSymbol, handler: QuickPanelTriggerHandler) => {
      if (!triggerRegistryRef.current.has(symbol)) {
        triggerRegistryRef.current.set(symbol, new Map())
      }

      const handlers = triggerRegistryRef.current.get(symbol)!
      handlers.set(toolKey, handler)

      return () => {
        const currentHandlers = triggerRegistryRef.current.get(symbol)
        if (!currentHandlers) return

        currentHandlers.delete(toolKey)
        if (currentHandlers.size === 0) {
          triggerRegistryRef.current.delete(symbol)
        }
      }
    },
    []
  )

  const emitTrigger = useCallback((symbol: QuickPanelReservedSymbol, payload?: unknown) => {
    const handlers = triggerRegistryRef.current.get(symbol)
    handlers?.forEach((handler) => {
      handler?.(payload)
    })
  }, [])

  // Stabilize parent actions (prevent dispatch context updates from parent action reference changes)
  const actionsRef = useRef(actions)
  useEffect(() => {
    actionsRef.current = actions
  }, [actions])

  const stableActions = useMemo(
    () => ({
      resizeTextArea: () => actionsRef.current.resizeTextArea(),
      addNewTopic: () => actionsRef.current.addNewTopic(),
      clearTopic: () => actionsRef.current.clearTopic(),
      onNewContext: () => actionsRef.current.onNewContext(),
      onTextChange: (updater: string | ((prev: string) => string)) => actionsRef.current.onTextChange(updater),
      toggleExpanded: (nextState?: boolean) => actionsRef.current.toggleExpanded(nextState)
    }),
    []
  )

  // State Context Value (updates when state changes)
  const stateValue = useMemo<InputbarToolsState>(
    () => ({
      files,
      mentionedModels,
      selectedKnowledgeBases,
      isExpanded,
      couldAddImageFile,
      couldMentionNotVisionModel,
      extensions
    }),
    [
      files,
      mentionedModels,
      selectedKnowledgeBases,
      isExpanded,
      couldAddImageFile,
      couldMentionNotVisionModel,
      extensions
    ]
  )

  // Tools Registry API (stable references for tool buttons)
  const toolsRegistryAPI = useMemo<ToolsRegistryAPI>(
    () => ({
      registerRootMenu,
      registerTrigger
    }),
    [registerRootMenu, registerTrigger]
  )

  // Triggers API (stable references for Inputbar component)
  const triggersAPI = useMemo<TriggersAPI>(
    () => ({
      emit: emitTrigger,
      getRootMenu: getQuickPanelRootMenu
    }),
    [emitTrigger, getQuickPanelRootMenu]
  )

  // Dispatch Context Value (stable references)
  const dispatchValue = useMemo<InputbarToolsDispatch>(
    () => ({
      // State setters (React guarantees stable references)
      setFiles,
      setMentionedModels,
      setSelectedKnowledgeBases,
      setIsExpanded,

      // Stable actions
      ...stableActions,

      // API objects
      toolsRegistry: toolsRegistryAPI,
      triggers: triggersAPI
    }),
    [stableActions, toolsRegistryAPI, triggersAPI]
  )

  // Internal Dispatch (contains setCouldAddImageFile and setExtensions)
  // These setters are exposed to Inputbar but not to tool buttons
  // Using a separate internal context to avoid polluting the main dispatch context
  const internalDispatchValue = useMemo(
    () => ({
      setCouldAddImageFile,
      setExtensions
    }),
    []
  )

  return (
    <InputbarToolsStateContext value={stateValue}>
      <InputbarToolsDispatchContext value={dispatchValue}>
        <InputbarToolsInternalDispatchContext value={internalDispatchValue}>
          {children}
        </InputbarToolsInternalDispatchContext>
      </InputbarToolsDispatchContext>
    </InputbarToolsStateContext>
  )
}

/**
 * Internal dispatch interface for Inputbar component only.
 * Used to set derived state (couldAddImageFile, extensions).
 */
interface InputbarToolsInternalDispatch {
  setCouldAddImageFile: React.Dispatch<React.SetStateAction<boolean>>
  setExtensions: React.Dispatch<React.SetStateAction<string[]>>
}

const InputbarToolsInternalDispatchContext = createContext<InputbarToolsInternalDispatch | undefined>(undefined)

/**
 * Internal hook for Inputbar component only.
 * Used to set derived state (couldAddImageFile, extensions).
 */
export const useInputbarToolsInternalDispatch = (): InputbarToolsInternalDispatch => {
  const context = use(InputbarToolsInternalDispatchContext)
  if (!context) {
    throw new Error('useInputbarToolsInternalDispatch must be used within InputbarToolsProvider')
  }
  return context
}
