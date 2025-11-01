import { useAppDispatch, useAppSelector } from '@renderer/store'
import type { NotesSettings } from '@renderer/store/note'
import { selectNotesPath, selectNotesSettings, setNotesPath, updateNotesSettings } from '@renderer/store/note'

export const useNotesSettings = () => {
  const dispatch = useAppDispatch()
  const settings = useAppSelector(selectNotesSettings)
  const notesPath = useAppSelector(selectNotesPath)

  const updateSettings = (newSettings: Partial<NotesSettings>) => {
    dispatch(updateNotesSettings(newSettings))
  }

  const updateNotesPath = (path: string) => {
    dispatch(setNotesPath(path))
  }

  return {
    settings,
    updateSettings,
    notesPath,
    updateNotesPath
  }
}
