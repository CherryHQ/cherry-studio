import { useMultiplePreferences } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { EditorView } from '@renderer/types'
import type { NotesSortType } from '@renderer/types/note'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useNotesSettings')

const NOTES_SETTINGS_PREFERENCE_KEYS = {
  isFullWidth: 'feature.notes.full_width',
  fontFamily: 'feature.notes.font_family',
  fontSize: 'feature.notes.font_size',
  showTableOfContents: 'feature.notes.show_table_of_contents',
  defaultViewMode: 'feature.notes.default_view_mode',
  defaultEditMode: 'feature.notes.default_edit_mode',
  showTabStatus: 'feature.notes.show_tab_status',
  notesPath: 'feature.notes.path',
  sortType: 'feature.notes.sort_type'
} as const

export interface NotesSettings {
  isFullWidth: boolean
  fontFamily: 'default' | 'serif'
  fontSize: number
  showTableOfContents: boolean
  defaultViewMode: 'edit' | 'read'
  defaultEditMode: Exclude<EditorView, 'read'>
  // Reserved for a tab-status display toggle; persisted now so v1 settings migrate losslessly.
  showTabStatus: boolean
}

export const useNotesSettings = () => {
  const { t } = useTranslation()
  const [values, setValues] = useMultiplePreferences(NOTES_SETTINGS_PREFERENCE_KEYS)

  const settings: NotesSettings = {
    isFullWidth: values.isFullWidth,
    fontFamily: values.fontFamily as NotesSettings['fontFamily'],
    fontSize: values.fontSize,
    showTableOfContents: values.showTableOfContents,
    defaultViewMode: values.defaultViewMode as NotesSettings['defaultViewMode'],
    defaultEditMode: values.defaultEditMode as NotesSettings['defaultEditMode'],
    showTabStatus: values.showTabStatus
  }

  const updateSettings = (newSettings: Partial<NotesSettings>) => {
    void setValues(newSettings).catch((error) => {
      logger.error('Failed to update notes settings', error as Error)
      window.toast.error(t('notes.settings.save_failed'))
    })
  }

  const updateNotesPath = (path: string) => {
    void setValues({ notesPath: path }).catch((error) => {
      logger.error('Failed to update notes path', error as Error)
      window.toast.error(t('notes.settings.save_failed'))
    })
  }

  const updateSortType = (value: NotesSortType) => {
    void setValues({ sortType: value }).catch((error) => {
      logger.error('Failed to update notes sort type', error as Error)
      window.toast.error(t('notes.settings.save_failed'))
    })
  }

  return {
    settings,
    updateSettings,
    notesPath: values.notesPath,
    updateNotesPath,
    sortType: values.sortType as NotesSortType,
    updateSortType
  }
}
