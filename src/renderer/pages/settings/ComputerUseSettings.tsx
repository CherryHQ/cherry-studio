import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import useSWRMutation from 'swr/mutation'

import { Button, Switch, HelpTooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { ErrorDetailAction } from '@renderer/components/ErrorDetailAction'
import { ErrorNotice } from '@renderer/components/ErrorNotice'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingsPageHeader
} from '@renderer/components/SettingsPrimitives'
import { ipcApi } from '@renderer/ipc'
import { isLinux } from '@renderer/utils/platform'

const logger = loggerService.withContext('ComputerUseSettings')
const PERMISSION_KEY = 'computer_use.get_permission_status'

export function ComputerUseSettings() {
  const { t } = useTranslation()
  const [approvedApps] = usePreference('app.computer_use.approved_apps')
  const [enabled, setEnabled] = usePreference('app.computer_use.agent_control.enabled')
  const [globalInput, setGlobalInput] = usePreference('app.computer_use.agent_control.global_input')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
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
  const recheck = () => {
    reset()
    void mutate()
  }

  return (
    <SettingsContentColumn>
      <SettingsPageHeader title={t('settings.computerUse.title')} help={t('settings.computerUse.description')} />
      <SettingGroup>
        <SettingRow className="flex-nowrap">
          <div className="min-w-0 flex-1">
            <SettingRowTitle className="flex items-center gap-1.5">
              <span id="computer-use-control-title">{t('settings.computerUse.control')}</span>{' '}
              <span id="computer-use-control-help" className="sr-only">
                {t('settings.computerUse.controlHelp')}
              </span>
              <HelpTooltip content={t('settings.computerUse.controlHelp')} />
            </SettingRowTitle>
          </div>
          <Switch
            checked={enabled}
            disabled={saving}
            aria-labelledby="computer-use-control-title"
            aria-describedby="computer-use-control-help"
            onCheckedChange={async (value) => {
              setSaving(true)
              setSaveError(null)
              try {
                await setEnabled(value)
              } catch (cause) {
                setSaveError(cause)
                logger.warn('Failed to change desktop control permission', cause as Error)
              } finally {
                setSaving(false)
              }
            }}
          />
        </SettingRow>
        {saveError != null && (
          <ErrorNotice
            variant="inline"
            className="mt-2"
            title={t('settings.computerUse.controlError')}
            detail={
              <ErrorDetailAction
                error={saveError}
                message={t('settings.computerUse.controlError')}
                operation="computer_use.preference"
                source="settings.computerUse"
              />
            }
          />
        )}
        {isLinux && enabled && (
          <>
            <SettingDivider />
            <SettingRow className="flex-nowrap items-start">
              <div className="min-w-0 flex-1">
                <SettingRowTitle id="computer-use-global-input-title">
                  {t('settings.computerUse.globalInput')}
                </SettingRowTitle>
                <SettingDescription id="computer-use-global-input-help">
                  {t('settings.computerUse.globalInputHelp')}
                </SettingDescription>
              </div>
              <Switch
                className="mt-0.5"
                checked={globalInput}
                disabled={saving}
                aria-labelledby="computer-use-global-input-title"
                aria-describedby="computer-use-global-input-help"
                onCheckedChange={async (value) => {
                  setSaving(true)
                  setSaveError(false)
                  try {
                    await setGlobalInput(value)
                  } catch (cause) {
                    setSaveError(true)
                    logger.warn('Failed to change the global input setting', cause as Error)
                  } finally {
                    setSaving(false)
                  }
                }}
              />
            </SettingRow>
          </>
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
                  <SettingRow className="flex-nowrap" data-testid={`computer-use-permission-${id}`}>
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
        {error || requestError ? (
          <ErrorNotice
            variant="inline"
            className="mt-3"
            title={t('settings.computerUse.error')}
            action={{ label: t('settings.computerUse.recheck'), disabled: busy, onClick: recheck }}
            detail={
              <ErrorDetailAction
                error={requestError ?? error}
                message={t('settings.computerUse.error')}
                operation={requestError ? 'computer_use.request_permissions' : 'computer_use.get_permission_status'}
                source="settings.computerUse"
              />
            }
          />
        ) : (
          <div className="mt-3">
            <Button variant="outline" size="sm" disabled={busy} onClick={recheck}>
              {t('settings.computerUse.recheck')}
            </Button>
          </div>
        )}
      </SettingGroup>
      <SettingGroup>
        <SettingRowTitle>{t('settings.computerUse.approval.saved')}</SettingRowTitle>
        {approvedApps.length === 0 && (
          <SettingDescription>{t('settings.computerUse.approval.empty')}</SettingDescription>
        )}
        {approvedApps.map((identity) => (
          <SettingRow key={identity}>
            <span className="min-w-0 flex-1 break-all text-sm">{identity}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={async () => {
                setSaving(true)
                setSaveError(false)
                try {
                  await ipcApi.request('computer_use.revoke_approval', { identity })
                } catch (error) {
                  logger.warn('Failed to revoke application approval', error as Error)
                  setSaveError(true)
                } finally {
                  setSaving(false)
                }
              }}>
              {t('common.delete')}
            </Button>
          </SettingRow>
        ))}
      </SettingGroup>
    </SettingsContentColumn>
  )
}
