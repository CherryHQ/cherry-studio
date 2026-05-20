import { usePreference } from '@data/hooks/usePreference'

export function useShowWorkspace() {
  const [showWorkspace, setShowWorkspace] = usePreference('feature.notes.show_workspace')

  return {
    showWorkspace,
    setShowWorkspace: (show: boolean) => void setShowWorkspace(show),
    toggleShowWorkspace: () => void setShowWorkspace(!showWorkspace)
  }
}
