import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import useSWRMutation from 'swr/mutation'

import { Button, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn
} from '@renderer/components/SettingsPrimitives'
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
    <SettingsContentColumn>
      <h1 className="text-xl font-semibold text-foreground">{t('settings.computerUse.title')}</h1>
      <SettingDescription>{t('settings.computerUse.description')}</SettingDescription>

      <SettingGroup>
        <SettingRow className="flex-nowrap items-start">
          <div className="min-w-0 flex-1">
            <SettingRowTitle id="computer-use-control-title">{t('settings.computerUse.control')}</SettingRowTitle>
            <SettingDescription id="computer-use-control-help">
              {t('settings.computerUse.controlHelp')}
            </SettingDescription>
          </div>
          <Switch
            className="mt-0.5"
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
        </SettingRow>
        {saveError && (
          <p role="alert" className="mt-2 text-error text-sm">
            {t('settings.computerUse.controlError')}
          </p>
        )}
        <SettingDivider />
        {busy && <SettingDescription role="status">{t('common.loading')}</SettingDescription>}
        {!error && data && (
          <>
            {data.permissions.length === 0 && (
              <SettingDescription>{t('settings.computerUse.noPermissions')}</SettingDescription>
            )}
            {data.permissions.map((permission, index) => {
              const id = permission.id
              const known = id === 'accessibility' || id === 'screenRecording'
              const label = known ? t(`settings.computerUse.${id}`) : permission.label
              return (
                <Fragment key={id}>
                  {index > 0 && <SettingDivider />}
                  <SettingRow className="flex-nowrap">
                    <div className="min-w-0 flex-1">
                      <SettingRowTitle>{label}</SettingRowTitle>
                      <SettingDescription className="mt-1">
                        {t(
                          `settings.computerUse.status.${permission.status === 'notDetermined' ? 'unknown' : permission.status}`
                        )}
                      </SettingDescription>
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
                  </SettingRow>
                </Fragment>
              )
            })}
          </>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {(error || requestError) && (
            <p role="alert" className="text-error text-sm">
              {t('settings.computerUse.error')}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              reset()
              void mutate()
            }}>
            {t('settings.computerUse.recheck')}
          </Button>
        </div>
      </SettingGroup>
    </SettingsContentColumn>
  )
}
