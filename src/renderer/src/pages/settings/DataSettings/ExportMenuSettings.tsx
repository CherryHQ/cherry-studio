import { useTheme } from '@renderer/context/ThemeProvider'
import { RootState, useAppDispatch } from '@renderer/store'
import { setExportMenuOptions } from '@renderer/store/settings'
import { Switch } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const ExportMenuOptions: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  const exportMenuOptions = useSelector((state: RootState) => state.settings.exportMenuOptions)

  const handleToggleOption = (option: string, checked: boolean) => {
    dispatch(
      setExportMenuOptions({
        ...exportMenuOptions,
        [option]: checked
      })
    )
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.export_menu.title')}</SettingTitle>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.image')}</SettingRowTitle>
        <Switch checked={exportMenuOptions.image} onChange={(checked) => handleToggleOption('image', checked)} />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.markdown')}</SettingRowTitle>
        <Switch checked={exportMenuOptions.markdown} onChange={(checked) => handleToggleOption('markdown', checked)} />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.markdown_reason')}</SettingRowTitle>
        <Switch
          checked={exportMenuOptions.markdown_reason}
          onChange={(checked) => handleToggleOption('markdown_reason', checked)}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.notion')}</SettingRowTitle>
        <Switch checked={exportMenuOptions.notion} onChange={(checked) => handleToggleOption('notion', checked)} />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.yuque')}</SettingRowTitle>
        <Switch checked={exportMenuOptions.yuque} onChange={(checked) => handleToggleOption('yuque', checked)} />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.joplin')}</SettingRowTitle>
        <Switch checked={exportMenuOptions.joplin} onChange={(checked) => handleToggleOption('joplin', checked)} />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.obsidian')}</SettingRowTitle>
        <Switch checked={exportMenuOptions.obsidian} onChange={(checked) => handleToggleOption('obsidian', checked)} />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.siyuan')}</SettingRowTitle>
        <Switch checked={exportMenuOptions.siyuan} onChange={(checked) => handleToggleOption('siyuan', checked)} />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.docx')}</SettingRowTitle>
        <Switch checked={exportMenuOptions.docx} onChange={(checked) => handleToggleOption('docx', checked)} />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.plain_text')}</SettingRowTitle>
        <Switch
          checked={exportMenuOptions.plain_text}
          onChange={(checked) => handleToggleOption('plain_text', checked)}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.notes')}</SettingRowTitle>
        <Switch checked={exportMenuOptions.notes} onChange={(checked) => handleToggleOption('notes', checked)} />
      </SettingRow>
    </SettingGroup>
  )
}

export default ExportMenuOptions
