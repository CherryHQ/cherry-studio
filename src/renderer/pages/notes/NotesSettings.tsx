import { Button, Input, Slider, Switch } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import Selector from '@renderer/components/Selector'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import {
  SettingContainer,
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/pages/settings'
import type { EditorView } from '@renderer/types'
import { FolderOpen } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('NotesSettings')

const NotesSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { settings, updateSettings, notesPath, updateNotesPath } = useNotesSettings()
  const [tempPath, setTempPath] = useState<string>(notesPath || '')
  const [isSelecting, setIsSelecting] = useState(false)

  // Update tempPath when notesPath changes (e.g., after initialization)
  useEffect(() => {
    if (notesPath) {
      setTempPath(notesPath)
    }
  }, [notesPath])

  const handleSelectWorkDirectory = async () => {
    try {
      setIsSelecting(true)
      const result = await window.api.file.selectFolder({
        title: t('notes.settings.data.current_work_directory')
      })

      if (result) {
        setTempPath(result)
      }
    } catch (error) {
      logger.error('Failed to select directory:', error as Error)
      window.toast.error(t('notes.settings.data.select_directory_failed'))
    } finally {
      setIsSelecting(false)
    }
  }

  const handleApplyPath = async () => {
    if (!tempPath) {
      window.toast.error(t('notes.settings.data.path_required'))
      return
    }

    try {
      // 验证目录是否可用
      const isValidDir = await window.api.file.validateNotesDirectory(tempPath)

      if (!isValidDir) {
        window.toast.error(t('notes.settings.data.invalid_directory'))
        return
      }

      updateNotesPath(tempPath)
      window.toast.success(t('notes.settings.data.path_updated'))
    } catch (error) {
      logger.error('Failed to apply notes path:', error as Error)
      window.toast.error(t('notes.settings.data.apply_path_failed'))
    }
  }

  const handleResetToDefault = async () => {
    try {
      const info = await window.api.getAppInfo()
      setTempPath(info.notesPath)
      updateNotesPath(info.notesPath)
      window.toast.success(t('notes.settings.data.reset_to_default'))
    } catch (error) {
      logger.error('Failed to reset to default:', error as Error)
      window.toast.error(t('notes.settings.data.reset_failed'))
    }
  }

  const isPathChanged = tempPath !== notesPath

  return (
    <SettingContainer theme={theme} style={{ background: 'transparent' }}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('notes.settings.data.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('notes.settings.data.current_work_directory')}</SettingRowTitle>
        </SettingRow>
        <div className="mt-2 flex flex-col gap-3">
          <div className="flex w-full items-center">
            <Input
              value={tempPath}
              onChange={(e) => setTempPath(e.target.value)}
              placeholder={t('notes.settings.data.work_directory_placeholder')}
              readOnly
            />
            <Button variant="default" onClick={handleSelectWorkDirectory} disabled={isSelecting} className="ml-2">
              <FolderOpen size={16} />
              {t('notes.settings.data.select')}
            </Button>
          </div>
          <div className="flex items-center gap-2 self-start">
            <Button onClick={handleApplyPath} disabled={!isPathChanged}>
              {t('notes.settings.data.apply')}
            </Button>
            <Button onClick={handleResetToDefault}>{t('notes.settings.data.reset_to_default')}</Button>
          </div>
        </div>
        <SettingRow>
          <SettingHelpText>{t('notes.settings.data.work_directory_description')}</SettingHelpText>
        </SettingRow>
      </SettingGroup>

      {/* Editor Settings */}
      <SettingGroup theme={theme}>
        <SettingTitle>{t('notes.settings.editor.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('notes.settings.editor.view_mode.title')}</SettingRowTitle>
          <Selector
            options={[
              { label: t('notes.settings.editor.view_mode.edit_mode'), value: 'edit' },
              { label: t('notes.settings.editor.view_mode.read_mode'), value: 'read' }
            ]}
            value={settings.defaultViewMode}
            onChange={(value: 'edit' | 'read') => updateSettings({ defaultViewMode: value })}
          />
        </SettingRow>
        <SettingHelpText>{t('notes.settings.editor.view_mode.description')}</SettingHelpText>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('notes.settings.editor.edit_mode.title')}</SettingRowTitle>
          <Selector
            options={[
              { label: t('notes.settings.editor.edit_mode.preview_mode'), value: 'preview' },
              { label: t('notes.settings.editor.edit_mode.source_mode'), value: 'source' }
            ]}
            value={settings.defaultEditMode}
            onChange={(value: Exclude<EditorView, 'read'>) => updateSettings({ defaultEditMode: value })}
          />
        </SettingRow>
        <SettingHelpText>{t('notes.settings.editor.edit_mode.description')}</SettingHelpText>
      </SettingGroup>

      {/* Display Settings */}
      <SettingGroup theme={theme}>
        <SettingTitle>{t('notes.settings.display.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('notes.settings.display.compress_content')}</SettingRowTitle>
          <Switch
            checked={!settings.isFullWidth}
            onCheckedChange={(checked) => updateSettings({ isFullWidth: !checked })}
          />
        </SettingRow>
        <SettingHelpText>{t('notes.settings.display.compress_content_description')}</SettingHelpText>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('notes.settings.display.font_size')}</SettingRowTitle>
          <div className="flex items-center">
            <Slider
              min={10}
              max={30}
              value={[settings.fontSize]}
              onValueChange={(value) => updateSettings({ fontSize: value[0] ?? settings.fontSize })}
              className="mr-4 w-50"
            />
            <span className="min-w-10 text-muted-foreground text-sm">{settings.fontSize}px</span>
          </div>
        </SettingRow>
        <SettingHelpText>{t('notes.settings.display.font_size_description')}</SettingHelpText>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('notes.settings.display.show_table_of_contents')}</SettingRowTitle>
          <Switch
            checked={settings.showTableOfContents}
            onCheckedChange={(checked) => updateSettings({ showTableOfContents: checked })}
          />
        </SettingRow>
        <SettingHelpText>{t('notes.settings.display.show_table_of_contents_description')}</SettingHelpText>
      </SettingGroup>
    </SettingContainer>
  )
}

export default NotesSettings
