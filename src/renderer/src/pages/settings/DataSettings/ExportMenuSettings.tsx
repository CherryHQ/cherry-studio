import { Switch } from '@cherrystudio/ui'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'
const ExportMenuOptions: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const [exportMenuOptions, setExportMenuOptions] = useMultiplePreferences({
    image: 'data.export.menus.image',
    markdown: 'data.export.menus.markdown',
    markdown_reason: 'data.export.menus.markdown_reason',
    notion: 'data.export.menus.notion',
    yuque: 'data.export.menus.yuque',
    joplin: 'data.export.menus.joplin',
    obsidian: 'data.export.menus.obsidian',
    siyuan: 'data.export.menus.siyuan',
    docx: 'data.export.menus.docx',
    plain_text: 'data.export.menus.plain_text'
  })

  const handleToggleOption = (option: string, checked: boolean) => {
    setExportMenuOptions({
      [option]: checked
    })
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.export_menu.title')}</SettingTitle>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.image')}</SettingRowTitle>
        <Switch
          isSelected={exportMenuOptions.image}
          onValueChange={(checked) => handleToggleOption('image', checked)}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.markdown')}</SettingRowTitle>
        <Switch
          isSelected={exportMenuOptions.markdown}
          onValueChange={(checked) => handleToggleOption('markdown', checked)}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.markdown_reason')}</SettingRowTitle>
        <Switch
          isSelected={exportMenuOptions.markdown_reason}
          onValueChange={(checked) => handleToggleOption('markdown_reason', checked)}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.notion')}</SettingRowTitle>
        <Switch
          isSelected={exportMenuOptions.notion}
          onValueChange={(checked) => handleToggleOption('notion', checked)}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.yuque')}</SettingRowTitle>
        <Switch
          isSelected={exportMenuOptions.yuque}
          onValueChange={(checked) => handleToggleOption('yuque', checked)}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.joplin')}</SettingRowTitle>
        <Switch
          isSelected={exportMenuOptions.joplin}
          onValueChange={(checked) => handleToggleOption('joplin', checked)}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.obsidian')}</SettingRowTitle>
        <Switch
          isSelected={exportMenuOptions.obsidian}
          onValueChange={(checked) => handleToggleOption('obsidian', checked)}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.siyuan')}</SettingRowTitle>
        <Switch
          isSelected={exportMenuOptions.siyuan}
          onValueChange={(checked) => handleToggleOption('siyuan', checked)}
        />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.docx')}</SettingRowTitle>
        <Switch isSelected={exportMenuOptions.docx} onValueChange={(checked) => handleToggleOption('docx', checked)} />
      </SettingRow>
      <SettingDivider />

      <SettingRow>
        <SettingRowTitle>{t('settings.data.export_menu.plain_text')}</SettingRowTitle>
        <Switch
          isSelected={exportMenuOptions.plain_text}
          onValueChange={(checked) => handleToggleOption('plain_text', checked)}
        />
      </SettingRow>
    </SettingGroup>
  )
}

export default ExportMenuOptions
