import { useAppSelector } from '@renderer/store'
import { IpcChannel } from '@shared/IpcChannel'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

const NavigationHandler: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const showSettingsShortcutEnabled = useAppSelector(
    (state) => state.shortcuts.shortcuts.find((s) => s.key === 'show_settings')?.enabled
  )

  useHotkeys(
    'meta+, ! ctrl+,',
    function () {
      if (location.pathname.startsWith('/settings')) {
        return
      }
      navigate({ to: '/settings/provider' })
    },
    {
      splitKey: '!',
      enableOnContentEditable: true,
      enableOnFormTags: true,
      enabled: showSettingsShortcutEnabled
    }
  )

  // Listen for navigate to About page event from macOS menu
  useEffect(() => {
    const handleNavigateToAbout = () => {
      navigate({ to: '/settings/about' })
    }

    const removeListener = window.electron.ipcRenderer.on(IpcChannel.Windows_NavigateToAbout, handleNavigateToAbout)

    return () => {
      removeListener()
    }
  }, [navigate])

  return null
}

export default NavigationHandler
