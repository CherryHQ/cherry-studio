import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useCache } from '@renderer/data/hooks/useCache'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { TerminalResourceState, TerminalResourceView } from '@shared/types/terminal'
import type { WorkspaceUsageRecord } from '@shared/types/workspaceUsage'

import { useRightPanelActions } from '../chat/panes/Shell'

function useTerminalResourcesState(sessionId: string, active: boolean) {
  const { t } = useTranslation()
  const panel = useRightPanelActions()
  const [tabs, setTabs] = useCache(`agent.resource_tabs.${sessionId || 'unbound'}`)
  const [claimId, setClaimId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cleanupTabs, setCleanupTabs] = useState<WorkspaceUsageRecord[]>([])
  const [selectedCleanupId, setSelectedCleanupId] = useState<string | null>(null)
  const [previousSessionId, setPreviousSessionId] = useState(sessionId)
  const currentSession = useRef(sessionId)
  currentSession.current = sessionId
  const present = useRef(active)
  present.current = active
  useEffect(
    () => () => {
      present.current = false
    },
    []
  )
  const selectedId = useRef(tabs.selectedTerminalId)
  const observed = useRef<TerminalResourceView[]>([])
  if (previousSessionId !== sessionId) {
    setPreviousSessionId(sessionId)
    setClaimId(null)
    setCreating(false)
    setError(null)
    setCleanupTabs([])
    setSelectedCleanupId(null)
    observed.current = []
  }
  selectedId.current = tabs.selectedTerminalId
  const {
    data,
    error: loadError,
    mutate
  } = useSWR(
    sessionId ? ['terminal-resources', sessionId] : null,
    async () => {
      const result = await ipcApi.request('terminal.list', { sessionId, selectedId: selectedId.current ?? undefined })
      return {
        ...result,
        resources: result.resources.map((item) => {
          const newer = observed.current.find(
            (previous) => previous.id === item.id && previous.revision > item.revision
          )
          return newer ?? item
        })
      }
    },
    { refreshInterval: active ? 500 : 0, dedupingInterval: 200 }
  )
  const cleanup = useSWR('terminal-cleanup-status', () => ipcApi.request('terminal.cleanup.status', {}), {
    refreshInterval: active ? 2000 : 0
  })
  const resources = data?.resources ?? []
  observed.current = resources
  useEffect(() => {
    if (!data) return
    setTabs((current) => {
      const added = data.resources.filter(
        (item) =>
          item.kind === 'pty' &&
          !current.terminals.some((tab) => tab.id === item.id) &&
          !current.hiddenTerminalIds.includes(item.id)
      )
      if (!added.length) return current
      return {
        ...current,
        terminals: [
          ...current.terminals,
          ...added.map((item, index) => ({
            id: item.id,
            title: `${item.shell} ${current.terminals.length + index + 1}`
          }))
        ]
      }
    })
  }, [data, setTabs])
  const update = useCallback(
    (resource: TerminalResourceState) => {
      void mutate(
        (current) => {
          const previous = current?.resources.find((item) => item.id === resource.id)
          if (previous && previous.revision >= resource.revision) return current
          const next = { ...previous, ...resource }
          return {
            resources: previous
              ? (current?.resources ?? []).map((item) => (item.id === resource.id ? next : item))
              : [...(current?.resources ?? []), next],
            truncated: current?.truncated ?? false
          }
        },
        { revalidate: false }
      )
    },
    [mutate]
  )
  const show = useCallback(
    (id: string, title?: string) => {
      setTabs((current) => ({
        ...current,
        selectedTerminalId: id,
        hiddenTerminalIds: current.hiddenTerminalIds.filter((item) => item !== id),
        terminals: current.terminals.some((item) => item.id === id)
          ? [...current.terminals]
          : [...current.terminals, { id, title: `${title ?? t('terminal.title')} ${current.terminals.length + 1}` }]
      }))
      setSelectedCleanupId(null)
      void mutate()
      panel.requestOpen('terminal', { userInitiated: true })
    },
    [setTabs, mutate, panel, t]
  )
  const close = (id: string) => {
    setTabs((current) => ({
      ...current,
      hiddenTerminalIds: [...new Set([...current.hiddenTerminalIds, id])],
      selectedTerminalId: current.selectedTerminalId === id ? null : current.selectedTerminalId
    }))
    setClaimId((current) => (current === id ? null : current))
  }
  const create = async () => {
    if (creating) return
    setCreating(true)
    try {
      const receipt = await ipcApi.request('terminal.create', {
        sessionId,
        shell: 'default',
        operationId: crypto.randomUUID()
      })
      if (receipt.kind !== 'resource')
        throw new Error(
          t('terminal.error.rejected', { reason: receipt.kind === 'rejected' ? receipt.reason : 'unknown' })
        )
      update(receipt.resource)
      if (present.current && currentSession.current === sessionId) {
        setClaimId(receipt.resource.id)
        show(receipt.resource.id, receipt.resource.shell)
      }
      if (currentSession.current === sessionId) setError(null)
    } catch (cause) {
      if (currentSession.current === sessionId) {
        setError(String(cause))
        toast.error(String(cause))
      }
    } finally {
      if (currentSession.current === sessionId) setCreating(false)
    }
  }
  const promote = async (resource: TerminalResourceState) => {
    try {
      const receipt = await ipcApi.request('terminal.promote', {
        ref: { host: resource.host, id: resource.id },
        operationId: crypto.randomUUID(),
        cancelRevision: resource.cancelRevision
      })
      if (receipt.kind !== 'resource')
        throw new Error(
          t('terminal.error.rejected', { reason: receipt.kind === 'rejected' ? receipt.reason : 'unknown' })
        )
      update(receipt.resource)
      if (currentSession.current === sessionId) setError(null)
    } catch (cause) {
      if (currentSession.current === sessionId) {
        setError(String(cause))
        toast.error(String(cause))
      }
    }
  }
  const openCleanup = (record: WorkspaceUsageRecord) => {
    setCleanupTabs((current) => (current.some((item) => item.id === record.id) ? current : [...current, record]))
    setSelectedCleanupId(record.id)
    panel.requestOpen('terminal', { userInitiated: true })
  }
  return {
    sessionId,
    resources,
    tabs,
    setTabs,
    show,
    close,
    create,
    creating,
    promote,
    update,
    claimId,
    clearClaim: () => setClaimId(null),
    error: error ?? (loadError ? String(loadError) : null),
    truncated: data?.truncated ?? false,
    cleanup,
    cleanupTabs,
    selectedCleanupId,
    openCleanup,
    closeCleanup: (id: string) => {
      setCleanupTabs((current) => current.filter((item) => item.id !== id))
      setSelectedCleanupId((current) => (current === id ? null : current))
    }
  }
}

const TerminalResourcesContext = createContext<ReturnType<typeof useTerminalResourcesState> | null>(null)

export function TerminalResourcesProvider({
  sessionId,
  active,
  children
}: {
  sessionId: string
  active: boolean
  children: ReactNode
}) {
  const value = useTerminalResourcesState(sessionId, active)
  return <TerminalResourcesContext value={value}>{children}</TerminalResourcesContext>
}

export const useOptionalTerminalResources = () => use(TerminalResourcesContext)
export function useTerminalResources() {
  const value = useOptionalTerminalResources()
  if (!value) throw new Error('Terminal resources provider is missing')
  return value
}
