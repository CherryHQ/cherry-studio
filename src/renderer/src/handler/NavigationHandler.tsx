import { useShortcut } from '@renderer/hooks/useShortcuts'
import { IpcChannel } from '@shared/IpcChannel'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

const NavigationHandler: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()

  useShortcut(
    'app.show_settings',
    () => {
      if (location.pathname.startsWith('/settings')) {
        return
      }
      void navigate({ to: '/settings/provider' })
    },
    {
      enableOnFormTags: true,
      enableOnContentEditable: true
    }
  )

  // Listen for navigate to About page event from macOS menu
  useEffect(() => {
    const handleNavigateToAbout = () => {
      void navigate({ to: '/settings/about' })
    }

    const removeListener = window.electron.ipcRenderer.on(IpcChannel.Windows_NavigateToAbout, handleNavigateToAbout)

    return () => {
      removeListener()
    }
  }, [navigate])

  return null
}

export default NavigationHandler
