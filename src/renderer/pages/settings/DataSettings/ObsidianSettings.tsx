import { type FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  EmptyState,
  RowFlex,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { ErrorDetailAction } from '@renderer/components/ErrorDetailAction'
import {
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { ipcApi } from '@renderer/ipc'
import { toastAppError } from '@renderer/services/AppErrorDetailService'

const logger = loggerService.withContext('ObsidianSettings')

const ObsidianSettings: FC = () => {
  const { t } = useTranslation()

  const [defaultObsidianVault, setDefaultObsidianVault] = usePreference('data.integration.obsidian.default_vault')

  const [vaults, setVaults] = useState<Array<{ path: string; name: string }>>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [loadError, setLoadError] = useState<unknown>(null)

  const saveVault = useCallback(
    async (vaultName: string) => {
      try {
        await setDefaultObsidianVault(vaultName)
      } catch (cause) {
        logger.error('Failed to save Obsidian vault', cause as Error)
        toastAppError(t('common.save_failed'), cause, {
          source: 'settings.obsidian',
          operation: 'obsidian.vault.save',
          recordId: vaultName
        })
      }
    },
    [setDefaultObsidianVault, t]
  )

  useEffect(() => {
    const fetchVaults = async () => {
      try {
        setLoading(true)
        setLoadError(null)
        const vaultsData = await ipcApi.request('export.obsidian.get_vaults')

        if (vaultsData.length === 0) {
          return
        }

        setVaults(vaultsData)

        if (!defaultObsidianVault) {
          void saveVault(vaultsData[0].name)
        }
      } catch (caught) {
        logger.error('Failed to fetch Obsidian vaults', caught as Error)
        setLoadError(caught)
      } finally {
        setLoading(false)
      }
    }

    void fetchVaults()
  }, [defaultObsidianVault, saveVault])

  const handleChange = (value: string) => {
    void saveVault(value)
  }

  const fetchFailureSummary = t('settings.data.obsidian.default_vault_fetch_error')

  return (
    <SettingGroup>
      <SettingTitle>{t('settings.data.obsidian.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow id="setting-data-obsidian-default-vault" className="scroll-mt-6">
        <SettingRowTitle>{t('settings.data.obsidian.default_vault')}</SettingRowTitle>
        <RowFlex className="gap-1.25">
          {loading ? (
            <Spinner text={t('common.loading')} />
          ) : vaults.length > 0 ? (
            <Select value={defaultObsidianVault || undefined} onValueChange={handleChange}>
              <SelectTrigger className="w-75 max-w-full">
                <SelectValue placeholder={t('settings.data.obsidian.default_vault_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {vaults.map((vault) => (
                  <SelectItem key={vault.name} value={vault.name}>
                    {vault.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : loadError != null ? (
            <div className="flex flex-col items-end gap-2">
              <EmptyState compact preset="no-resource" description={fetchFailureSummary} />
              <ErrorDetailAction
                error={loadError}
                message={fetchFailureSummary}
                source="settings.obsidian"
                operation="obsidian.vaults.fetch"
              />
            </div>
          ) : (
            <EmptyState
              compact
              preset="no-resource"
              description={t('settings.data.obsidian.default_vault_no_vaults')}
            />
          )}
        </RowFlex>
      </SettingRow>
    </SettingGroup>
  )
}

export default ObsidianSettings
