import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { useMessageParts } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import { useRightPanelActions } from '@renderer/components/chat/panes/Shell'
import { acceptSideChat, connectSideChats, useSideChats } from '@renderer/hooks/useSideChats'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { locateSideChatSource } from '@renderer/utils/sideChatAnchor'
import type { SideChatSource } from '@shared/data/types/sideChat'

interface SideChatContextValue {
  sourceTopicId?: string
  selectedId?: string
  pending?: SideChatSource
  error: boolean
  loading: boolean
  openSource: (source: SideChatSource) => void
  open: (topicId: string) => void
  select: (topicId?: string) => void
  reload: () => void
}
const SideChatContext = createContext<SideChatContextValue | null>(null)
export const useSideChatContext = () => use(SideChatContext)

export function SideChatProvider({ sourceTopicId, children }: PropsWithChildren<{ sourceTopicId?: string }>) {
  const actions = useRightPanelActions()
  const [selected, setSelected] = useState<Record<string, string | undefined>>({})
  const [pending, setPending] = useState<SideChatSource>()
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
      if (sourceTopicId) setSelected((current) => ({ ...current, [sourceTopicId]: topicId }))
      setPending(undefined)
    },
    [sourceTopicId]
  )
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
      select(undefined)
      setPending(source)
      actions.requestOpen('side-chat', { userInitiated: true })
    },
    [actions, select]
  )
  const value = useMemo(
    () => ({
      sourceTopicId,
      selectedId: sourceTopicId ? selected[sourceTopicId] : undefined,
      pending: pending?.topicId === sourceTopicId ? pending : undefined,
      error,
      loading,
      openSource,
      open,
      select,
      reload
    }),
    [sourceTopicId, selected, pending, error, loading, openSource, open, select, reload]
  )
  return <SideChatContext value={value}>{children}</SideChatContext>
}

export function SideChatMarkers({ messageId, aggregate = false }: { messageId: string; aggregate?: boolean }) {
  const context = useSideChatContext()
  const views = useSideChats(context?.sourceTopicId)
  const { t } = useTranslation()
  const parts = useMessageParts(messageId)
  const current = parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  if (!context) return null
  const matches = views.filter((view) => view.metadata.snapshot.messageId === messageId)
  if (aggregate && matches.length)
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={(event) => {
          event.stopPropagation()
          context.open(matches[0].topicId)
        }}>
        {t('side_chat.questions', { count: matches.reduce((total, view) => total + view.questionCount, 0) })}
      </Button>
    )
  return matches.map((view) => (
    <Button
      variant="ghost"
      size="sm"
      key={view.topicId}
      className="rounded-sm px-1 text-link hover:bg-muted focus-visible:bg-muted"
      onClick={() => context.open(view.topicId)}
      title={
        locateSideChatSource(current, view.metadata.snapshot) === null
          ? t('side_chat.location_unavailable')
          : view.metadata.snapshot.selection
      }>
      {t('side_chat.questions', { count: view.questionCount })}
    </Button>
  ))
}
