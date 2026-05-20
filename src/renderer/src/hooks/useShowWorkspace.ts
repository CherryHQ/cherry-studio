import { usePreference } from '@data/hooks/usePreference'
import { useCallback, useEffect, useRef } from 'react'

export function useShowWorkspace() {
  const [showWorkspace, setShowWorkspace] = usePreference('feature.notes.show_workspace')
  const showWorkspaceRef = useRef(showWorkspace)

  useEffect(() => {
    showWorkspaceRef.current = showWorkspace
  }, [showWorkspace])

  const updateShowWorkspace = useCallback(
    (show: boolean) => {
      showWorkspaceRef.current = show
      void setShowWorkspace(show)
    },
    [setShowWorkspace]
  )
  const toggleShowWorkspace = useCallback(() => {
    const nextShowWorkspace = !showWorkspaceRef.current
    showWorkspaceRef.current = nextShowWorkspace
    void setShowWorkspace(nextShowWorkspace)
  }, [setShowWorkspace])

  return {
    showWorkspace,
    setShowWorkspace: updateShowWorkspace,
    toggleShowWorkspace
  }
}
