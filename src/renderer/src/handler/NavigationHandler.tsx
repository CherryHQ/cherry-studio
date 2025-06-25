import { useAppDispatch, useAppSelector } from '@renderer/store'
import { openTab } from '@renderer/store/tabs'
import { useHotkeys } from 'react-hotkeys-hook'
import { useLocation } from 'react-router-dom'

const NavigationHandler: React.FC = () => {
  const location = useLocation()
  const dispatch = useAppDispatch()
  const showSettingsShortcutEnabled = useAppSelector(
    (state) => state.shortcuts.shortcuts.find((s) => s.key === 'show_settings')?.enabled
  )

  useHotkeys(
    'meta+, ! ctrl+,',
    function () {
      if (location.pathname.startsWith('/settings')) {
        return
      }
      dispatch(
        openTab({
          type: 'page',
          route: '/settings/provider',
          title: 'Settings',
          canClose: true,
          isPinned: false
        })
      )
    },
    {
      splitKey: '!',
      enableOnContentEditable: true,
      enableOnFormTags: true,
      enabled: showSettingsShortcutEnabled
    }
  )

  return null
}

export default NavigationHandler
