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
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const logger = loggerService.withContext('ObsidianSettings')

const ObsidianSettings: FC = () => {
  const { t } = useTranslation()

  const [defaultObsidianVault, setDefaultObsidianVault] = usePreference('data.integration.obsidian.default_vault')

  const [vaults, setVaults] = useState<Array<{ path: string; name: string }>>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // 组件加载时获取Vault列表
  useEffect(() => {
    const fetchVaults = async () => {
      try {
        setLoading(true)
        setError(null)
        const vaultsData = await window.api.obsidian.getVaults()

        if (vaultsData.length === 0) {
          setError(t('settings.data.obsidian.default_vault_no_vaults'))
          setLoading(false)
          return
        }

        setVaults(vaultsData)

        // 如果没有设置默认vault，则选择第一个
        if (!defaultObsidianVault && vaultsData.length > 0) {
          void setDefaultObsidianVault(vaultsData[0].name)
        }
      } catch (error) {
        logger.error('获取Obsidian Vault失败:', error as Error)
        setError(t('settings.data.obsidian.default_vault_fetch_error'))
      } finally {
        setLoading(false)
      }
    }

    void fetchVaults()
  }, [defaultObsidianVault, setDefaultObsidianVault, t])

  const handleChange = (value: string) => {
    void setDefaultObsidianVault(value)
  }

  return (
    <SettingGroup>
      <SettingTitle>{t('settings.data.obsidian.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.obsidian.default_vault')}</SettingRowTitle>
        <RowFlex className="gap-1.25">
          {loading ? (
            <Spinner />
          ) : vaults.length > 0 ? (
            <Select value={defaultObsidianVault || undefined} onValueChange={handleChange}>
              <SelectTrigger className="w-[300px]">
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
          ) : (
            <EmptyState
              compact
              preset="no-resource"
              description={error || t('settings.data.obsidian.default_vault_no_vaults')}
            />
          )}
        </RowFlex>
      </SettingRow>
    </SettingGroup>
  )
}

export default ObsidianSettings
