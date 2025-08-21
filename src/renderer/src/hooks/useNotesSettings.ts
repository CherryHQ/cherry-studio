import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  NotesSettings,
  selectFolderPath,
  selectNotesSettings,
  setFolderPath,
  updateNotesSettings
} from '@renderer/store/note'

export const useNotesSettings = () => {
  const dispatch = useAppDispatch()
  const settings = useAppSelector(selectNotesSettings)
  const folderPath = useAppSelector(selectFolderPath)

  const updateSettings = (newSettings: Partial<NotesSettings>) => {
    dispatch(updateNotesSettings(newSettings))
  }

  const updateFolderPath = (path: string) => {
    dispatch(setFolderPath(path))
  }

  return {
    settings,
    updateSettings,
    folderPath,
    updateFolderPath
  }
}
