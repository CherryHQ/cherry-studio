import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, InfoTooltip, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { SettingDivider, SettingRow, SettingRowTitle } from '@renderer/components/SettingsPrimitives'
import { ipcApi } from '@renderer/ipc'
import type { OutputFor } from '@shared/ipc/types'

const logger = loggerService.withContext('MemoryDreamingControls')

const scope = { kind: 'shared' } as const

export function MemoryDreamingControls() {
  const { t, i18n } = useTranslation()
  const labelId = useId()
  const generationLabelId = useId()
  const [generation, setGeneration] = usePreference('feature.memory.generation.enabled')
  const [automatic, setAutomatic] = usePreference('feature.memory.dreaming.enabled')
  const [status, setStatus] = useState<OutputFor<'memory.dreaming.status'>>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const value = await ipcApi.request('memory.dreaming.status', scope)
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
  }, [])

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

  const active = status?.status === 'running'
  return (
    <div>
      <SettingRow className="flex-nowrap">
        <SettingRowTitle className="flex-1 gap-1">
          <label id={generationLabelId}>{t('settings.memory.generation')}</label>
          <InfoTooltip content={t('settings.memory.generation.tooltip')} />
        </SettingRowTitle>
        <Switch
          checked={generation}
          disabled={busy}
          aria-labelledby={generationLabelId}
          onCheckedChange={(value) => void run(() => setGeneration(value))}
        />
      </SettingRow>
      <SettingDivider />
      <div>
        <SettingRow className="flex-nowrap">
          <SettingRowTitle className="flex-1 gap-1">
            <label id={labelId}>{t('settings.memory.dreaming.automatic')}</label>
            <InfoTooltip content={t('settings.memory.dreaming.tooltip')} />
          </SettingRowTitle>
          <Switch
            checked={automatic}
            disabled={busy}
            aria-labelledby={labelId}
            onCheckedChange={(value) => void run(() => setAutomatic(value))}
          />
        </SettingRow>
        {(failed || active || status?.status === 'failed' || status?.lastResult) && (
          <SettingRow className="mt-3">
            <div className="min-w-0 flex-1 space-y-1">
              {failed || status?.status === 'failed' ? (
                <p role="alert" className="text-sm text-error">
                  {t(
                    status?.reason === 'model'
                      ? 'settings.memory.dreaming.model_required'
                      : status?.reason === 'budget'
                        ? 'settings.memory.dreaming.budget'
                        : 'settings.memory.dreaming.failed'
                  )}
                </p>
              ) : active ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {t('settings.memory.dreaming.running')}
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
            {active && (
              <Button
                variant="outline"
                className="ml-auto"
                disabled={busy}
                onClick={() => void run(() => ipcApi.request('memory.dreaming.cancel', scope))}>
                {t('common.cancel')}
              </Button>
            )}
          </SettingRow>
        )}
      </div>
    </div>
  )
}
