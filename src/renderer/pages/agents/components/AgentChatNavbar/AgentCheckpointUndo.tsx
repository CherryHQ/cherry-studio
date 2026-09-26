import { Undo2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'

interface Props {
  sessionId: string
}

/**
 * O1 — the session always has a pre-turn checkpoint by the time a turn settles
 * (see `CheckpointService`); this button only shows up while one is still
 * unconsumed, and restoring it clears it again.
 */
const AgentCheckpointUndo = ({ sessionId }: Props) => {
  const { t } = useTranslation()
  const [available, setAvailable] = useState(false)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    let cancelled = false
    setAvailable(false)
    void ipcApi.request('agent_checkpoint.get', { sessionId }).then((status) => {
      if (!cancelled) setAvailable(status.available)
    })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  useIpcOn('agent_checkpoint.updated', (payload) => {
    if (payload.sessionId === sessionId) setAvailable(payload.available)
  })

  const handleRestore = useCallback(async () => {
    setRestoring(true)
    try {
      const result = await ipcApi.request('agent_checkpoint.restore', { sessionId })
      if (result.restored) {
        toast.success(t('agent.checkpoint.restored'))
      }
    } catch {
      toast.error(t('agent.checkpoint.restore_failed'))
    } finally {
      setRestoring(false)
    }
  }, [sessionId, t])

  if (!available) return null

  return (
    <Tooltip title={t('agent.checkpoint.undo_tooltip')} delay={500}>
      <Button variant="ghost" size="sm" onClick={() => void handleRestore()} disabled={restoring}>
        <Undo2 size={14} className="mr-1" />
        {t('agent.checkpoint.undo_button')}
      </Button>
    </Tooltip>
  )
}

export default AgentCheckpointUndo
