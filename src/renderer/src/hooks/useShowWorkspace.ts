import { useAppDispatch, useAppSelector } from '@renderer/store'
import { selectNotesSettings, updateNotesSettings } from '@renderer/store/note'

export function useShowWorkspace() {
  const dispatch = useAppDispatch()
  const settings = useAppSelector(selectNotesSettings)
  const showWorkspace = settings.showWorkspace

  return {
    showWorkspace,
    setShowWorkspace: (show: boolean) => dispatch(updateNotesSettings({ showWorkspace: show })),
    toggleShowWorkspace: () => dispatch(updateNotesSettings({ showWorkspace: !showWorkspace }))
  }
}
