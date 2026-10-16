import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import useSWRMutation from 'swr/mutation'

import { Button, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { ipcApi } from '@renderer/ipc'

const logger = loggerService.withContext('ComputerUseSettings')
const PERMISSION_KEY = 'computer_use.get_permission_status'

export function ComputerUseSettings() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = usePreference('app.computer_use.agent_control.enabled')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    PERMISSION_KEY,
    () => ipcApi.request(PERMISSION_KEY),
    {
      revalidateOnFocus: true,
      focusThrottleInterval: 0,
      dedupingInterval: 0,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
      onError: (cause) => logger.warn('Permission query failed', cause)
    }
  )
  const {
    trigger,
    isMutating,
    error: requestError,
    reset
  } = useSWRMutation(
    PERMISSION_KEY,
    (_, { arg }: { arg: 'accessibility' | 'screenRecording' }) =>
      ipcApi.request('computer_use.request_permissions', { ids: [arg] }),
    {
      populateCache: true,
      throwOnError: false,
      onError: (cause) => logger.warn('Permission request failed', cause)
    }
  )
  const busy = isLoading || isValidating || isMutating

  return (
    <SettingsContentColumn innerClassName="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-base font-semibold">{t('settings.computerUse.title')}</h1>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            reset()
            void mutate()
          }}>
          {t('common.refresh')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('settings.computerUse.description')}</p>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id="computer-use-control-title" className="text-sm font-medium">
            {t('settings.computerUse.control')}
          </p>
          <p id="computer-use-control-help" className="text-sm text-muted-foreground">
            {t('settings.computerUse.controlHelp')}
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={saving}
          aria-labelledby="computer-use-control-title"
          aria-describedby="computer-use-control-help"
          onCheckedChange={async (value) => {
            setSaving(true)
            setSaveError(false)
            try {
              await setEnabled(value)
            } catch (cause) {
              setSaveError(true)
              logger.warn('Failed to change desktop control permission', cause as Error)
            } finally {
              setSaving(false)
            }
          }}
        />
      </div>
      {saveError && (
        <p role="alert" className="text-sm text-destructive">
          {t('settings.computerUse.controlError')}
        </p>
      )}
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      )}
      {(error || requestError) && (
        <p role="alert" className="text-sm text-destructive">
          {t('settings.computerUse.error')}
        </p>
      )}
      {!error && data && (
        <div className="flex flex-col divide-y divide-border">
          {data.permissions.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('settings.computerUse.noPermissions')}</p>
          )}
          {data.permissions.map((permission) => {
            const id = permission.id
            const known = id === 'accessibility' || id === 'screenRecording'
            const label = known ? t(`settings.computerUse.${id}`) : permission.label
            return (
              <div key={id} className="flex items-center justify-between gap-4 py-4">
                <div className="flex flex-col gap-1">
                  <h2 className="text-sm font-medium">{label}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      `settings.computerUse.status.${permission.status === 'notDetermined' ? 'unknown' : permission.status}`
                    )}
                  </p>
                </div>
                {known &&
                  permission.status !== 'granted' &&
                  permission.status !== 'unavailable' &&
                  permission.interaction !== 'none' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-label={t('settings.computerUse.requestLabel', { permission: label })}
                      onClick={() => void trigger(id)}>
                      {t('settings.computerUse.request')}
                    </Button>
                  )}
              </div>
            )
          })}
        </div>
      )}
    </SettingsContentColumn>
  )
}
