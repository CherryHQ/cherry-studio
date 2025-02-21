import { locationPathnameMappingPathMap } from '@renderer/components/app/Sidebar'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { settingMenuItemPathList } from '@renderer/pages/settings/SettingsPage'
import Logger from 'electron-log'
import React from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useLocation, useNavigate } from 'react-router-dom'

const NavigationHandler: React.FC = () => {
  const navigate = useNavigate()
  const { sidebarIcons } = useSettings()
  const { pathname: navigationPathname } = useLocation()
  useHotkeys(
    'meta+, ! ctrl+,',
    function () {
      navigate('/settings/provider')
    },
    { splitKey: '!' }
  )

  const navigationListAndIndex = (): {
    err: boolean
    errorMessage: string
    navigationList: string[]
    index: number
    defaultSettingSubPathname?: string
  } => {
    const pinnedPathname = sidebarIcons.visible.map((iconName) => locationPathnameMappingPathMap[iconName])
    if (pinnedPathname.length !== sidebarIcons.visible.length) {
      return {
        err: true,
        errorMessage: '[NavigationHandler] pinnedPathname length not match',
        navigationList: [],
        index: 0
      }
    } else {
      const navigationList = [...pinnedPathname, '/settings']
      const currentPathname = (() => {
        const path = navigationPathname.split('/')[1]
        if (path === '') {
          return '/'
        } else {
          return `/${path}`
        }
      })()

      const index = navigationList.findIndex((iconName) => iconName === currentPathname)
      if (index === -1) {
        return {
          err: true,
          errorMessage: '[NavigationHandler] currentPathname not found',
          navigationList,
          index: 0
        }
      } else {
        return {
          err: false,
          errorMessage: '',
          navigationList,
          index
        }
      }
    }
  }

  const gotoNavigateByIndex = (navigationList: string[], index: number) => {
    const listLength = navigationList.length
    let i = index % listLength
    if (i < 0) {
      i = (i + listLength) % listLength
    }
    const targetPathname = navigationList[i]
    if (targetPathname.startsWith('/settings')) {
      navigate(settingMenuItemPathList?.[0] ?? '/settings/provider')
    } else {
      navigate(targetPathname)
    }
  }

  useShortcut('switch_to_prev_main_navigation', () => {
    const result = navigationListAndIndex()
    if (result.err) {
      Logger.error(result.errorMessage)
    } else {
      const { navigationList, index } = result
      gotoNavigateByIndex(navigationList, index - 1)
    }
  })

  useShortcut('switch_to_next_main_navigation', () => {
    const result = navigationListAndIndex()
    if (result.err) {
      Logger.error(result.errorMessage)
    } else {
      const { navigationList, index } = result
      gotoNavigateByIndex(navigationList, index + 1)
    }
  })

  return null
}

export default NavigationHandler
