import { FC, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import { useAppSelector } from '@renderer/store'
import { migrateTopicGroups } from '@renderer/utils/migration'

const NavigationHandler: FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const showSettingsShortcutEnabled = useAppSelector(
    (state) => state.shortcuts.shortcuts.find((s) => s.key === 'show_settings')?.enabled
  )

  // 进行数据迁移
  useEffect(() => {
    // 执行话题分组迁移
    migrateTopicGroups()
  }, [])

  // 处理导航
  useEffect(() => {
    if (location.pathname === '/') {
      return
    }
  }, [location, navigate])

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

  return null
}

export default NavigationHandler
