import { application } from '@application'
import { type WindowInfo, WindowType } from '@main/core/window/types'

/**
 * Windows running a full TabsProvider: every Main window, plus SubWindows the user can currently
 * see. Single definition on purpose — notification delivery and conversation-navigation ownership
 * must agree on the candidate set, or a card lands in a window the navigator won't treat as owner.
 */
export function getFullChromeWindowInfos(): WindowInfo[] {
  const windowManager = application.get('WindowManager')
  return [
    ...windowManager.getWindowInfosByType(WindowType.Main),
    ...windowManager.getWindowInfosByType(WindowType.SubWindow).filter((window) => window.isVisible || window.isFocused)
  ]
}
