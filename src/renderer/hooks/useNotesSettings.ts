import { useTranslation } from 'react-i18next'

import { useMultiplePreferences } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import type { EditorView } from '@renderer/types/app'
import type { NotesSortType } from '@renderer/types/note'

const logger = loggerService.withContext('useNotesSettings')

const NOTES_SETTINGS_PREFERENCE_KEYS = {
  isFullWidth: 'feature.notes.full_width',
  fontFamily: 'feature.notes.font_family',
  fontSize: 'feature.notes.font_size',
  showTableOfContents: 'feature.notes.show_table_of_contents',
  lineBreaks: 'feature.notes.line_breaks',
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
  /** Render single line breaks as new lines (Obsidian-style) instead of collapsing them */
  lineBreaks: boolean
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
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- Compatibility: legacy preference strings are unchecked; RichEditor owns the existing non-serif font fallback.
    fontFamily: values.fontFamily as NotesSettings['fontFamily'],
    fontSize: values.fontSize,
    showTableOfContents: values.showTableOfContents,
    lineBreaks: values.lineBreaks,
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- Compatibility: NotesEditor combines both raw mode strings; defaulting either alone can enable editing of a read-only document.
    defaultViewMode: values.defaultViewMode as NotesSettings['defaultViewMode'],
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- Compatibility: retain unknown historic modes for NotesEditor's current read-only fallback instead of coercing them to editable preview.
    defaultEditMode: values.defaultEditMode as NotesSettings['defaultEditMode'],
    showTabStatus: values.showTabStatus
  }

  const updateSettings = (newSettings: Partial<NotesSettings>) => {
    void setValues(newSettings).catch((error) => {
      logger.error('Failed to update notes settings', error)
      toast.error(t('notes.settings.save_failed'))
    })
  }

  const updateNotesPath = (path: string) => {
    void setValues({ notesPath: path }).catch((error) => {
      logger.error('Failed to update notes path', error)
      toast.error(t('notes.settings.save_failed'))
    })
  }

  const updateSortType = (value: NotesSortType) => {
    void setValues({ sortType: value }).catch((error) => {
      logger.error('Failed to update notes sort type', error)
      toast.error(t('notes.settings.save_failed'))
    })
  }

  return {
    settings,
    updateSettings,
    notesPath: values.notesPath,
    updateNotesPath,
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- Compatibility: sorting handles unknown stored strings with its lexical fallback; retain the raw preference and menu selection state.
    sortType: values.sortType as NotesSortType,
    updateSortType
  }
}
