import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ConfirmDialog } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { AgentFileSnapshotReason } from '@shared/ipc/schemas/agentFileSnapshot'
import type { OutputFor } from '@shared/ipc/types'

type State = OutputFor<'agent.file_snapshot.state'>

export const snapshotReasonKeys: Record<AgentFileSnapshotReason, string> = {
  'empty-write': 'agent.file_snapshot.unavailable',
  'large-deletion': 'agent.file_snapshot.unavailable',
  undecidable: 'agent.file_snapshot.unavailable',
  'snapshot-failed': 'agent.file_snapshot.failed',
  'snapshot-conflict': 'agent.file_snapshot.state_changed',
  SNAPSHOT_ROOT_IN_WORKSPACE: 'agent.file_snapshot.unavailable',
  'turn-active': 'agent.file_snapshot.pending',
  stale: 'agent.file_snapshot.state_changed',
  unverifiable: 'agent.file_snapshot.unavailable',
  conflict: 'agent.file_snapshot.conflict',
  pending: 'agent.file_snapshot.pending',
  'no-round': 'agent.file_snapshot.no_round',
  empty: 'agent.file_snapshot.empty',
  failed: 'agent.file_snapshot.failed',
  unknown: 'agent.file_snapshot.unavailable',
  restored: 'agent.file_snapshot.unavailable',
  'round-mismatch': 'agent.file_snapshot.state_changed',
  'revision-mismatch': 'agent.file_snapshot.state_changed',
  partial: 'agent.file_snapshot.unavailable',
  'approval-unavailable': 'agent.file_snapshot.unavailable',
  'approval-denied': 'agent.file_snapshot.unavailable',
  'invalid-path': 'agent.file_snapshot.unavailable',
  'outside-workspace': 'agent.file_snapshot.unavailable'
}

export function AgentFileSnapshotUndo({ sessionId, pending }: { sessionId: string; pending: boolean }) {
  const { t } = useTranslation()
  const [state, setState] = useState<State | null>(null)
  const [confirmation, setConfirmation] = useState<State | null>(null)
  const open = confirmation !== null
  const [invalidated, setInvalidated] = useState(false)
  const changed =
    invalidated ||
    (open && state !== null && (state.replyId !== confirmation.replyId || state.revision !== confirmation.revision))
  useEffect(() => {
    if (open && state && (state.replyId !== confirmation.replyId || state.revision !== confirmation.revision))
      setInvalidated(true)
  }, [open, confirmation, state])
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    const result = await ipcApi.request('agent.file_snapshot.state', { sessionId })
    setState(result)
  }, [sessionId])
  useEffect(() => {
    let active = true
    setState(null)
    void ipcApi
      .request('agent.file_snapshot.state', { sessionId })
      .then((result) => {
        if (active) setState(result)
      })
      .catch(() => {
        if (active) setState(null)
      })
    return () => {
      active = false
    }
  }, [sessionId, pending])
  const reason = pending ? 'pending' : state?.reason
  const title = t(reason ? snapshotReasonKeys[reason] : 'agent.file_snapshot.unavailable')
  return (
    <>
      <span title={state?.canUndo && !pending ? undefined : title}>
        <Button
          variant="ghost"
          size="sm"
          disabled={!state?.canUndo || pending || busy}
          onClick={() => {
            setInvalidated(false)
            setConfirmation(state)
          }}>
          {t('agent.file_snapshot.action')}
        </Button>
      </span>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setConfirmation(null)
        }}
        title={t('agent.file_snapshot.confirm_title')}
        description={changed ? t('agent.file_snapshot.state_changed') : t('agent.file_snapshot.confirm_description')}
        content={
          <ul>
            {confirmation?.files
              .filter((file) => file.status !== 'already-restored')
              .map((file) => (
                <li key={file.path}>{file.path}</li>
              ))}
          </ul>
        }
        confirmText={t('agent.file_snapshot.action')}
        cancelText={t('common.cancel')}
        confirmLoading={busy}
        confirmDisabled={changed || !state || pending}
        cancelDisabled={busy}
        onConfirm={async () => {
          if (!confirmation?.replyId || !confirmation.revision || changed || !state || pending || busy) return false
          setBusy(true)
          try {
            const result = await ipcApi.request('agent.file_snapshot.undo', {
              sessionId,
              replyId: confirmation.replyId,
              expectedRevision: confirmation.revision
            })
            if (result.reason) {
              const failed = result.files.filter(
                (file) => !['restored', 'removed', 'already-restored'].includes(file.status)
              ).length
              toast.warning(
                t('agent.file_snapshot.warning', {
                  count: failed || confirmation.files.filter((file) => file.status !== 'already-restored').length
                })
              )
            } else {
              toast.success(
                t('agent.file_snapshot.success', {
                  count: result.files.filter((file) => file.status === 'restored' || file.status === 'removed').length
                })
              )
            }
            await refresh()
            return true
          } catch {
            toast.warning(t('agent.file_snapshot.failed'))
            await refresh().catch(() => setState(null))
            return true
          } finally {
            setBusy(false)
          }
        }}
      />
    </>
  )
}
