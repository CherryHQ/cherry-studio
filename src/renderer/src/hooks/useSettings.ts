import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  SendMessageShortcut,
  setSendMessageShortcut as _setSendMessageShortcut,
  setTheme,
  setTopicPosition,
  setTray,
  setWindowStyle
} from '@renderer/store/settings'
import { ThemeMode } from '@renderer/types'

export function useSettings() {
  const settings = useAppSelector((state) => state.settings)
  const dispatch = useAppDispatch()

  return {
    ...settings,
    setSendMessageShortcut(shortcut: SendMessageShortcut) {
      dispatch(_setSendMessageShortcut(shortcut))
    },
    setTray(isActive: boolean) {
      dispatch(setTray(isActive))
    },
    setTheme(theme: ThemeMode) {
      dispatch(setTheme(theme))
    },
    setWindowStyle(windowStyle: 'transparent' | 'opaque') {
      dispatch(setWindowStyle(windowStyle))
    },
    setTopicPosition(topicPosition: 'left' | 'right') {
      dispatch(setTopicPosition(topicPosition))
    }
  }
}

export function useMessageStyle() {
  const { messageStyle } = useSettings()
  const isBubbleStyle = messageStyle === 'bubble'

  return {
    isBubbleStyle
  }
}
