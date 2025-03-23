import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { RootState, useAppDispatch } from '@renderer/store'
import { setObsidianFolder, setObsidianTages, setObsidianValut } from '@renderer/store/settings'
import Input from 'antd/es/input/Input'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const ObsidianSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  // const obsidianApiKey = useSelector((state: RootState) => state.settings.obsidianApiKey)
  // const obsidianUrl = useSelector((state: RootState) => state.settings.obsidianUrl)

  const obsidianVault = useSelector((state: RootState) => state.settings.obsidianValut)
  const obsidianFolder = useSelector((state: RootState) => state.settings.obsidianFolder)
  const obsidianTags = useSelector((state: RootState) => state.settings.obsidianTages)

  const handleObsidianVaultChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setObsidianValut(e.target.value))
  }

  const handleObsidianFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setObsidianFolder(e.target.value))
  }

  const handleObsidianVaultBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    dispatch(setObsidianValut(e.target.value))
  }

  const handleObsidianFolderBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    dispatch(setObsidianFolder(e.target.value))
  }

  const handleObsidianTagsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setObsidianTages(e.target.value))
  }

  const handleObsidianTagsBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    dispatch(setObsidianTages(e.target.value))
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.obsidian.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.obsidian.vault')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={obsidianVault || ''}
            onChange={handleObsidianVaultChange}
            onBlur={handleObsidianVaultBlur}
            style={{ width: 315 }}
            placeholder={t('settings.data.obsidian.vault_placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle style={{ display: 'flex', alignItems: 'center' }}>
          <span>{t('settings.data.obsidian.folder')}</span>
        </SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            value={obsidianFolder || ''}
            onChange={handleObsidianFolderChange}
            onBlur={handleObsidianFolderBlur}
            style={{ width: 315 }}
            placeholder={t('settings.data.obsidian.folder_placeholder')}
          />
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle style={{ display: 'flex', alignItems: 'center' }}>
          <span>{t('settings.data.obsidian.tags')}</span>
        </SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            value={obsidianTags || ''}
            onChange={handleObsidianTagsChange}
            onBlur={handleObsidianTagsBlur}
            style={{ width: 315 }}
            placeholder={t('settings.data.obsidian.tags_placeholder')}
          />
        </HStack>
      </SettingRow>
    </SettingGroup>
  )
}

export default ObsidianSettings
