import { QuickPanelListItem, QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
import { FileType, FileTypes, KnowledgeBase, Model } from '@renderer/types'
import React, { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'

type QuickPanelTriggerHandler = (payload?: unknown) => void

export interface InputbarToolsContextValue {
  // State
  files: FileType[]
  setFiles: React.Dispatch<React.SetStateAction<FileType[]>>
  mentionedModels: Model[]
  setMentionedModels: React.Dispatch<React.SetStateAction<Model[]>>
  selectedKnowledgeBases: KnowledgeBase[]
  setSelectedKnowledgeBases: React.Dispatch<React.SetStateAction<KnowledgeBase[]>>
  text: string
  setText: React.Dispatch<React.SetStateAction<string>>
  isExpanded: boolean
  setIsExpanded: React.Dispatch<React.SetStateAction<boolean>>

  // Actions
  resizeTextArea: () => void
  addNewTopic: () => void
  clearTopic: () => void
  onNewContext: () => void

  // Additional shared state
  couldAddImageFile: boolean
  setCouldAddImageFile: React.Dispatch<React.SetStateAction<boolean>>
  couldMentionNotVisionModel: boolean
  setCouldMentionNotVisionModel: React.Dispatch<React.SetStateAction<boolean>>
  extensions: string[]
  setExtensions: React.Dispatch<React.SetStateAction<string[]>>

  // Quick panel coordination
  quickPanelRootMenu: QuickPanelListItem[]
  registerQuickPanelRootMenu: (toolKey: string, entries: QuickPanelListItem[]) => () => void
  registerQuickPanelTrigger: (
    toolKey: string,
    symbol: QuickPanelReservedSymbol,
    handler: QuickPanelTriggerHandler
  ) => () => void
  emitQuickPanelTrigger: (symbol: QuickPanelReservedSymbol, payload?: unknown) => void
}

const InputbarToolsContext = createContext<InputbarToolsContextValue | undefined>(undefined)

export const useInputbarTools = (): InputbarToolsContextValue => {
  const context = use(InputbarToolsContext)
  if (!context) {
    throw new Error('useInputbarTools must be used within InputbarToolsProvider')
  }
  return context
}

interface InputbarToolsProviderProps {
  children: React.ReactNode
  initialState?: Partial<{
    files: FileType[]
    mentionedModels: Model[]
    selectedKnowledgeBases: KnowledgeBase[]
    text: string
    isExpanded: boolean
    couldAddImageFile: boolean
    extensions: string[]
  }>
  actions: {
    resizeTextArea: () => void
    addNewTopic: () => void
    clearTopic: () => void
    onNewContext: () => void
  }
}

export const InputbarToolsProvider: React.FC<InputbarToolsProviderProps> = ({ children, initialState, actions }) => {
  // State management
  const [files, setFiles] = useState<FileType[]>(initialState?.files || [])
  const [mentionedModels, setMentionedModels] = useState<Model[]>(initialState?.mentionedModels || [])
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<KnowledgeBase[]>(
    initialState?.selectedKnowledgeBases || []
  )
  const [text, setText] = useState(initialState?.text || '')
  const [isExpanded, setIsExpanded] = useState(initialState?.isExpanded || false)
  const [couldAddImageFile, setCouldAddImageFile] = useState(initialState?.couldAddImageFile || false)
  const [couldMentionNotVisionModel, setCouldMentionNotVisionModel] = useState(true)
  const [extensions, setExtensions] = useState<string[]>(initialState?.extensions || [])

  // Quick panel menu registry
  const rootMenuRegistryRef = useRef(new Map<string, QuickPanelListItem[]>())
  const [quickPanelRootMenu, setQuickPanelRootMenu] = useState<QuickPanelListItem[]>([])
  const [menuVersion, setMenuVersion] = useState(0)

  const registerQuickPanelRootMenu = useCallback((toolKey: string, entries: QuickPanelListItem[]) => {
    rootMenuRegistryRef.current.set(toolKey, entries)
    setMenuVersion((v) => v + 1) // Trigger effect to update menu

    return () => {
      rootMenuRegistryRef.current.delete(toolKey)
      setMenuVersion((v) => v + 1) // Trigger effect to update menu
    }
  }, [])

  // Update menu when registry changes
  useEffect(() => {
    const newMenu = Array.from(rootMenuRegistryRef.current.values()).flat()
    setQuickPanelRootMenu(newMenu)
  }, [menuVersion])

  // Quick panel trigger registry
  const triggerRegistryRef = useRef(new Map<QuickPanelReservedSymbol, Map<string, QuickPanelTriggerHandler>>())

  const registerQuickPanelTrigger = useCallback(
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

  const emitQuickPanelTrigger = useCallback((symbol: QuickPanelReservedSymbol, payload?: unknown) => {
    const handlers = triggerRegistryRef.current.get(symbol)
    handlers?.forEach((handler) => {
      handler?.(payload)
    })
  }, [])

  useEffect(() => {
    const hasImage = files.some((file) => file.type === FileTypes.IMAGE)
    setCouldMentionNotVisionModel(!hasImage)
  }, [files])

  const contextValue = useMemo<InputbarToolsContextValue>(
    () => ({
      // State
      files,
      setFiles,
      mentionedModels,
      setMentionedModels,
      selectedKnowledgeBases,
      setSelectedKnowledgeBases,
      text,
      setText,
      isExpanded,
      setIsExpanded,

      // Actions
      ...actions,

      // Additional state
      couldAddImageFile,
      setCouldAddImageFile,
      couldMentionNotVisionModel,
      setCouldMentionNotVisionModel,
      extensions,
      setExtensions,

      // Quick panel coordination
      quickPanelRootMenu,
      registerQuickPanelRootMenu,
      registerQuickPanelTrigger,
      emitQuickPanelTrigger
    }),
    [
      files,
      mentionedModels,
      selectedKnowledgeBases,
      text,
      isExpanded,
      couldAddImageFile,
      couldMentionNotVisionModel,
      extensions,
      actions,
      quickPanelRootMenu,
      registerQuickPanelRootMenu,
      registerQuickPanelTrigger,
      emitQuickPanelTrigger
    ]
  )

  return <InputbarToolsContext value={contextValue}>{children}</InputbarToolsContext>
}
