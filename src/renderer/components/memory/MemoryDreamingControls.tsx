import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { OutputFor } from '@shared/ipc/types'
import type { MemoryScope } from '@shared/types/memory'

const logger = loggerService.withContext('MemoryDreamingControls')

export function MemoryDreamingControls({ scope }: { scope: MemoryScope }) {
  const { t, i18n } = useTranslation()
  const labelId = useId()
  const generationLabelId = useId()
  const [generation, setGeneration] = usePreference('feature.memory.generation.enabled')
  const [automatic, setAutomatic] = usePreference('feature.memory.dreaming.enabled')
  const [status, setStatus] = useState<OutputFor<'memory.dreaming.status'>>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const kind = scope.kind
  const agentId = scope.kind === 'private' ? scope.agentId : undefined

  useEffect(() => {
    let active = true
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const value = await ipcApi.request(
          'memory.dreaming.status',
          agentId ? { kind: 'private', agentId } : { kind: 'shared' }
        )
        if (active) setStatus(value)
      } catch (error) {
        if (active) setFailed(true)
        logger.warn('Memory organization status is unavailable', { error })
      } finally {
        pending = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [kind, agentId])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setFailed(false)
    try {
      await action()
      setStatus(await ipcApi.request('memory.dreaming.status', scope))
    } catch (error) {
      setFailed(true)
      logger.warn('Memory organization action failed', { error })
    } finally {
      setBusy(false)
    }
  }

  const active = status?.pending || status?.status === 'queued'
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <label id={generationLabelId} className="text-sm">
          {t('settings.memory.generation')}
        </label>
        <Switch
          checked={generation}
          disabled={busy}
          aria-labelledby={generationLabelId}
          onCheckedChange={(value) => void run(() => setGeneration(value))}
        />
      </div>
      <div className="space-y-2 pl-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {kind === 'shared' ? (
            <label id={labelId} className="flex items-center gap-3 text-sm">
              {t('settings.memory.dreaming.automatic')}
              <Switch
                checked={automatic}
                disabled={busy || !generation}
                aria-labelledby={labelId}
                onCheckedChange={(value) => void run(() => setAutomatic(value))}
              />
            </label>
          ) : (
            <span className="text-sm">{t('settings.memory.dreaming.title')}</span>
          )}
          <Button
            variant="ghost"
            disabled={busy || !status || !generation}
            onClick={() =>
              void run(() => ipcApi.request(active ? 'memory.dreaming.cancel' : 'memory.dreaming.request', scope))
            }>
            {t(active ? 'common.cancel' : 'settings.memory.dreaming.run')}
          </Button>
        </div>
        {failed || (generation && status?.status === 'failed') ? (
          <p role="alert" className="text-sm text-error">
            {t(
              status?.reason === 'model'
                ? 'settings.memory.dreaming.model_required'
                : status?.reason === 'budget'
                  ? 'settings.memory.dreaming.budget'
                  : 'settings.memory.dreaming.failed'
            )}
          </p>
        ) : generation && active ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t(status.status === 'queued' ? 'settings.memory.dreaming.waiting' : 'settings.memory.dreaming.running')}
          </p>
        ) : null}
        {status?.lastResult && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('settings.memory.dreaming.last_result', {
              result: t(
                status.lastResult.outcome === 'completed'
                  ? 'settings.memory.dreaming.result.completed'
                  : status.lastResult.outcome === 'failed'
                    ? 'settings.memory.dreaming.result.failed'
                    : 'settings.memory.dreaming.result.cancelled'
              ),
              time: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(
                status.lastResult.finishedAt
              )
            })}
          </p>
        )}
      </div>
    </div>
  )
}
