import NavigationService from '@renderer/services/NavigationService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addTab, Tab } from '@renderer/store/tabs'
import { useEffect } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useLocation, useNavigate } from 'react-router-dom'

const NavigationHandler: React.FC = () => {
  const dispatch = useAppDispatch()
  const location = useLocation()
  const navigate = useNavigate()
  const tabs = useAppSelector((state) => state.tabs.tabs)

  const showSettingsShortcutEnabled = useAppSelector(
    (state) => state.shortcuts.shortcuts.find((s) => s.key === 'show_settings')?.enabled
  )

  useEffect(() => {
    NavigationService.setNavigate(navigate)
  }, [navigate])

  useHotkeys(
    'meta+, ! ctrl+,',
    function () {
      if (location.pathname.startsWith('/settings')) {
        return
      }
      navigate('/settings/provider')
    },
    {
      splitKey: '!',
      enableOnContentEditable: true,
      enableOnFormTags: true,
      enabled: showSettingsShortcutEnabled
    }
  )

  // 初始化 home tab
  useEffect(() => {
    if (tabs.length === 0) {
      const homeTab: Tab = {
        id: 'home',
        titleKey: 'title.home',
        title: '',
        path: '/',
        iconType: 'home'
      }
      dispatch(addTab(homeTab))
    }
  }, [dispatch, tabs.length])

  return null
}

export default NavigationHandler
