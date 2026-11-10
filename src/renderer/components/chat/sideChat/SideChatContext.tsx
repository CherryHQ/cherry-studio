import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'

import { useRightPanelActions } from '@renderer/components/chat/panes/Shell'
import { acceptSideChat, connectSideChats } from '@renderer/hooks/useSideChats'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SideChatSource } from '@shared/data/types/sideChat'

interface SideChatContextValue {
  agentId?: string
  modelId?: UniqueModelId
  setModelId: (modelId?: UniqueModelId) => void
  sourceTopicId?: string
  selectedId?: string
  pending?: SideChatSource
  error: boolean
  loading: boolean
  openSource: (source: SideChatSource) => void
  open: (topicId: string) => void
  select: (topicId?: string) => void
  completeCreate: (source: SideChatSource, topicId: string) => void
  reload: () => void
}
const SideChatContext = createContext<SideChatContextValue | null>(null)
export const useSideChatContext = () => use(SideChatContext)

export function SideChatProvider({
  sourceTopicId,
  agentId,
  modelId: ownerModelId,
  children
}: PropsWithChildren<{ sourceTopicId?: string; modelId?: UniqueModelId; agentId?: string }>) {
  const [model, setModel] = useState<{ sourceTopicId?: string; modelId?: UniqueModelId }>({})
  const setModelId = useCallback((modelId?: UniqueModelId) => setModel({ sourceTopicId, modelId }), [sourceTopicId])
  const modelId = ownerModelId ?? (model.sourceTopicId === sourceTopicId ? model.modelId : undefined)
  const actions = useRightPanelActions()
  const [{ selected, pending }, setSelection] = useState<{
    selected: Record<string, string | undefined>
    pending?: SideChatSource
  }>({ selected: {} })
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const requestSequence = useRef(0)
  const reload = useCallback(() => {
    if (!sourceTopicId) return
    connectSideChats()
    const sequence = ++requestSequence.current
    setLoading(true)
    void ipcApi.request('side_chat.list', { sourceTopicId }).then(
      (views) => {
        views.forEach(acceptSideChat)
        if (sequence === requestSequence.current) {
          setError(false)
          setLoading(false)
        }
      },
      () => {
        if (sequence === requestSequence.current) {
          setError(true)
          setLoading(false)
        }
      }
    )
  }, [sourceTopicId])
  const invalidateRequests = useCallback(() => {
    ++requestSequence.current
  }, [])
  useEffect(() => {
    reload()
    return invalidateRequests
  }, [reload, invalidateRequests])
  useIpcOn('side_chat.sources_changed', (event) => {
    if (event.sourceTopicId === sourceTopicId) reload()
  })
  const select = useCallback(
    (topicId?: string) => {
      setSelection((current) => ({
        selected: sourceTopicId ? { ...current.selected, [sourceTopicId]: topicId } : current.selected
      }))
    },
    [sourceTopicId]
  )
  const completeCreate = useCallback((source: SideChatSource, topicId: string) => {
    setSelection((current) =>
      current.pending === source ? { selected: { ...current.selected, [source.topicId]: topicId } } : current
    )
  }, [])
  const open = useCallback(
    (topicId: string) => {
      connectSideChats()
      select(topicId)
      actions.requestOpen('side-chat', { userInitiated: true })
      void ipcApi.request('side_chat.get', { topicId }).then(acceptSideChat, () => setError(true))
    },
    [actions, select]
  )
  const openSource = useCallback(
    (source: SideChatSource) => {
      if (!source.selection?.trim() || source.topicId !== sourceTopicId) return
      setSelection((current) => ({
        selected: { ...current.selected, [source.topicId]: undefined },
        // Reselecting even the same excerpt must invalidate earlier creation results.
        pending: { ...source }
      }))
      actions.requestOpen('side-chat', { userInitiated: true })
    },
    [actions, sourceTopicId]
  )
  const value = useMemo(
    () => ({
      agentId,
      sourceTopicId,
      modelId,
      setModelId,
      selectedId: sourceTopicId ? selected[sourceTopicId] : undefined,
      pending: pending?.topicId === sourceTopicId ? pending : undefined,
      error,
      loading,
      openSource,
      open,
      select,
      completeCreate,
      reload
    }),
    [
      agentId,
      sourceTopicId,
      modelId,
      setModelId,
      selected,
      pending,
      error,
      loading,
      openSource,
      open,
      select,
      completeCreate,
      reload
    ]
  )
  return <SideChatContext value={value}>{children}</SideChatContext>
}
