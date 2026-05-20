import { usePreference } from '@data/hooks/usePreference'
import type { EditorView } from '@renderer/types'
import type { NotesSortType } from '@renderer/types/note'

export interface NotesSettings {
  isFullWidth: boolean
  fontFamily: 'default' | 'serif'
  fontSize: number
  showTableOfContents: boolean
  defaultViewMode: 'edit' | 'read'
  defaultEditMode: Exclude<EditorView, 'read'>
  showTabStatus: boolean
  showWorkspace: boolean
}

export const useNotesSettings = () => {
  const [isFullWidth, setIsFullWidth] = usePreference('feature.notes.full_width')
  const [fontFamily, setFontFamily] = usePreference('feature.notes.font_family')
  const [fontSize, setFontSize] = usePreference('feature.notes.font_size')
  const [showTableOfContents, setShowTableOfContents] = usePreference('feature.notes.show_table_of_contents')
  const [defaultViewMode, setDefaultViewMode] = usePreference('feature.notes.default_view_mode')
  const [defaultEditMode, setDefaultEditMode] = usePreference('feature.notes.default_edit_mode')
  const [showTabStatus, setShowTabStatus] = usePreference('feature.notes.show_tab_status')
  const [showWorkspace, setShowWorkspace] = usePreference('feature.notes.show_workspace')
  const [notesPath, setNotesPath] = usePreference('feature.notes.path')
  const [sortType, setSortType] = usePreference('feature.notes.sort_type')

  const settings: NotesSettings = {
    isFullWidth,
    fontFamily: fontFamily as NotesSettings['fontFamily'],
    fontSize,
    showTableOfContents,
    defaultViewMode: defaultViewMode as NotesSettings['defaultViewMode'],
    defaultEditMode: defaultEditMode as NotesSettings['defaultEditMode'],
    showTabStatus,
    showWorkspace
  }

  const updateSettings = (newSettings: Partial<NotesSettings>) => {
    if (newSettings.isFullWidth !== undefined) void setIsFullWidth(newSettings.isFullWidth)
    if (newSettings.fontFamily !== undefined) void setFontFamily(newSettings.fontFamily)
    if (newSettings.fontSize !== undefined) void setFontSize(newSettings.fontSize)
    if (newSettings.showTableOfContents !== undefined) void setShowTableOfContents(newSettings.showTableOfContents)
    if (newSettings.defaultViewMode !== undefined) void setDefaultViewMode(newSettings.defaultViewMode)
    if (newSettings.defaultEditMode !== undefined) void setDefaultEditMode(newSettings.defaultEditMode)
    if (newSettings.showTabStatus !== undefined) void setShowTabStatus(newSettings.showTabStatus)
    if (newSettings.showWorkspace !== undefined) void setShowWorkspace(newSettings.showWorkspace)
  }

  const updateNotesPath = (path: string) => {
    void setNotesPath(path)
  }

  const updateSortType = (value: NotesSortType) => {
    void setSortType(value)
  }

  return {
    settings,
    updateSettings,
    notesPath,
    updateNotesPath,
    sortType: sortType as NotesSortType,
    updateSortType
  }
}
