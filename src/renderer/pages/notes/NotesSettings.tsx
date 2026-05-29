import { Button, Input, PageSidePanelItem, PageSidePanelSection, Slider, Switch, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import Selector from '@renderer/components/Selector'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import type { EditorView } from '@renderer/types'
import { FolderOpen } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('NotesSettings')

const NotesSettings: FC = () => {
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
    <div className="flex flex-col gap-8">
      <PageSidePanelSection title={t('notes.settings.data.title')}>
        <div className="flex flex-col gap-5">
          <PageSidePanelItem
            title={t('notes.settings.data.current_work_directory')}
            description={t('notes.settings.data.work_directory_description')}>
            <div className="flex min-w-0 items-center gap-2">
              <Input
                value={tempPath}
                onChange={(e) => setTempPath(e.target.value)}
                placeholder={t('notes.settings.data.work_directory_placeholder')}
                readOnly
                className="min-w-0 flex-1"
              />
              <Tooltip content={t('notes.settings.data.select')} delay={800}>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={handleSelectWorkDirectory}
                  disabled={isSelecting}
                  className="shrink-0"
                  aria-label={t('notes.settings.data.select')}>
                  <FolderOpen size={16} />
                </Button>
              </Tooltip>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="emphasis" onClick={handleApplyPath} disabled={!isPathChanged}>
                {t('notes.settings.data.apply')}
              </Button>
              <Button variant="outline" onClick={handleResetToDefault}>
                {t('notes.settings.data.reset_to_default')}
              </Button>
            </div>
          </PageSidePanelItem>
        </div>
      </PageSidePanelSection>

      <PageSidePanelSection title={t('notes.settings.editor.title')}>
        <div className="flex flex-col gap-5">
          <PageSidePanelItem
            title={t('notes.settings.editor.view_mode.title')}
            description={t('notes.settings.editor.view_mode.description')}
            action={
              <Selector
                options={[
                  { label: t('notes.settings.editor.view_mode.edit_mode'), value: 'edit' },
                  { label: t('notes.settings.editor.view_mode.read_mode'), value: 'read' }
                ]}
                value={settings.defaultViewMode}
                onChange={(value: 'edit' | 'read') => updateSettings({ defaultViewMode: value })}
              />
            }
          />
          <PageSidePanelItem
            title={t('notes.settings.editor.edit_mode.title')}
            description={t('notes.settings.editor.edit_mode.description')}
            action={
              <Selector
                options={[
                  { label: t('notes.settings.editor.edit_mode.preview_mode'), value: 'preview' },
                  { label: t('notes.settings.editor.edit_mode.source_mode'), value: 'source' }
                ]}
                value={settings.defaultEditMode}
                onChange={(value: Exclude<EditorView, 'read'>) => updateSettings({ defaultEditMode: value })}
              />
            }
          />
        </div>
      </PageSidePanelSection>

      <PageSidePanelSection title={t('notes.settings.display.title')}>
        <div className="flex flex-col gap-5">
          <PageSidePanelItem
            title={t('notes.settings.display.compress_content')}
            description={t('notes.settings.display.compress_content_description')}
            action={
              <Switch
                checked={!settings.isFullWidth}
                onCheckedChange={(checked) => updateSettings({ isFullWidth: !checked })}
              />
            }
          />
          <PageSidePanelItem
            title={t('notes.settings.display.font_size')}
            description={t('notes.settings.display.font_size_description')}>
            <div className="flex items-center gap-3">
              <Slider
                min={10}
                max={30}
                value={[settings.fontSize]}
                onValueChange={(value) => updateSettings({ fontSize: value[0] ?? settings.fontSize })}
                className="flex-1"
              />
              <span className="w-10 text-right text-muted-foreground text-sm tabular-nums">{settings.fontSize}px</span>
            </div>
          </PageSidePanelItem>
          <PageSidePanelItem
            title={t('notes.settings.display.show_table_of_contents')}
            description={t('notes.settings.display.show_table_of_contents_description')}
            action={
              <Switch
                checked={settings.showTableOfContents}
                onCheckedChange={(checked) => updateSettings({ showTableOfContents: checked })}
              />
            }
          />
        </div>
      </PageSidePanelSection>
    </div>
  )
}

export default NotesSettings
