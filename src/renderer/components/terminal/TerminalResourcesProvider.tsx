import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useCache } from '@renderer/data/hooks/useCache'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { TerminalResourceState, TerminalResourceView } from '@shared/types/terminal'
import type { WorkspaceUsageRecord } from '@shared/types/workspaceUsage'

import { useRightPanelActions } from '../chat/panes/Shell'

type TerminalRef = Pick<TerminalResourceView, 'id' | 'host'>
type TerminalCloseResult = 'closed' | 'unconfirmed' | 'rejected' | 'cancelled'

function useTerminalResourcesState(sessionId: string, active: boolean) {
  const { t } = useTranslation()
  const panel = useRightPanelActions()
  const [tabs, setTabs] = useCache(`agent.resource_tabs.${sessionId || 'unbound'}`)
  const [claimId, setClaimId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [closingIds, setClosingIds] = useState<string[]>([])
  const closes = useRef(new Map<string, Promise<TerminalCloseResult>>())
  const [closeIntents, setCloseIntents] = useState<TerminalRef[]>([])
  const [closeError, setCloseError] = useState<{ ref: TerminalRef; message: string } | null>(null)
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
    setClosingIds([])
    setCloseIntents([])
    setCloseError(null)
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
    { refreshInterval: active || closeIntents.length ? 500 : 0, dedupingInterval: 200 }
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
  const finishClose = useCallback(
    (closed: TerminalRef[]) => {
      const ids = new Set<string>(closed.map((ref) => ref.id))
      const matches = (ref: TerminalRef) =>
        closed.some((item) => item.id === ref.id && item.host.generation === ref.host.generation)
      setTabs((current) => ({
        ...current,
        hiddenTerminalIds: [...new Set([...current.hiddenTerminalIds, ...ids])],
        selectedTerminalId:
          current.selectedTerminalId && ids.has(current.selectedTerminalId) ? null : current.selectedTerminalId
      }))
      setClaimId((current) => (current && ids.has(current) ? null : current))
      setCloseIntents((current) => current.filter((ref) => !matches(ref)))
      setCloseError((current) => (current && matches(current.ref) ? null : current))
    },
    [setTabs]
  )
  useEffect(() => {
    const completed = closeIntents.filter((ref) =>
      data?.resources.some(
        (item) => item.id === ref.id && item.host.generation === ref.host.generation && item.cleanup === 'confirmed'
      )
    )
    if (completed.length) finishClose(completed)
  }, [data, closeIntents, finishClose])
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
  const close = (id: string): Promise<TerminalCloseResult> => {
    const resource = observed.current.find((item) => item.id === id)
    if (!resource) return Promise.resolve('rejected')
    const key = JSON.stringify([sessionId, resource.host.generation, id])
    const pending = closes.current.get(key)
    if (pending) return pending
    const ref = { id: resource.id, host: resource.host }
    const work = (async (): Promise<TerminalCloseResult> => {
      try {
        if (resource.cleanup !== 'confirmed') {
          const confirmed = await popup.confirm({
            title: t('terminal.close'),
            content: t('terminal.close_confirm'),
            okText: t('terminal.close'),
            cancelText: t('common.cancel'),
            okButtonProps: { danger: true }
          })
          if (!confirmed) return 'cancelled'
          if (currentSession.current !== sessionId) return 'rejected'
        }
        const latest = observed.current.find((item) => item.id === id)
        if (latest?.host.generation !== ref.host.generation) return 'rejected'
        setClosingIds((current) => [...current, id])
        if (latest.cleanup !== 'confirmed') {
          const receipt = await ipcApi.request('terminal.stop', {
            ref,
            operationId: crypto.randomUUID(),
            controlRevision: latest.controlRevision,
            cancelRevision: latest.cancelRevision
          })
          if (receipt.kind !== 'resource')
            throw new Error(
              t('terminal.error.rejected', { reason: receipt.kind === 'rejected' ? receipt.reason : 'unknown' })
            )
          if (currentSession.current !== sessionId) return 'rejected'
          const current = observed.current.find((item) => item.id === id)
          if (current?.host.generation !== resource.host.generation) return 'rejected'
          update(receipt.resource)
          if (receipt.resource.cleanup !== 'confirmed') {
            setCloseIntents((current) =>
              current.some((item) => item.id === ref.id && item.host.generation === ref.host.generation)
                ? current
                : [...current, ref]
            )
            setCloseError({ ref, message: t('terminal.cleanup.protected') })
            return 'unconfirmed'
          }
        }
        if (currentSession.current !== sessionId) return 'rejected'
        finishClose([ref])
        return 'closed'
      } catch (cause) {
        if (currentSession.current === sessionId) {
          setCloseError({ ref, message: String(cause) })
          toast.error(String(cause))
        }
        return 'rejected'
      }
    })().finally(() => {
      closes.current.delete(key)
      if (currentSession.current === sessionId) setClosingIds((current) => current.filter((item) => item !== id))
    })
    closes.current.set(key, work)
    return work
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
    closingIds,
    promote,
    update,
    claimId,
    clearClaim: () => setClaimId(null),
    error: error ?? closeError?.message ?? (loadError ? String(loadError) : null),
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
