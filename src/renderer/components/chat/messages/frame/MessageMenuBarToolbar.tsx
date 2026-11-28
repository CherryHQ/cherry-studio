import type {
  MessageMenuBarActionContext,
  MessageMenuBarResolvedAction,
  MessageMenuBarResolvedToolbarAction,
  MessageMenuBarToolbarRenderContext,
  MessageMenuBarTranslationItem
} from './messageMenuBarActions'
import { renderDefaultToolbarAction } from './MessageMenuBarToolbarRenderers'

interface MessageMenuBarToolbarActionProps {
  action: MessageMenuBarResolvedToolbarAction
  actionContext: MessageMenuBarActionContext
  executeAction: (action: MessageMenuBarResolvedAction) => void | Promise<void>
  hasMenuActions: boolean
  getMenuActions: () => MessageMenuBarResolvedAction[]
  onMenuOpenChange?: (open: boolean) => void
  softHoverBg: boolean
  hasTranslationItems: boolean
  getTranslationItems: () => MessageMenuBarTranslationItem[]
}

export function MessageMenuBarToolbarAction({
  action,
  actionContext,
  executeAction,
  hasMenuActions,
  getMenuActions,
  onMenuOpenChange,
  softHoverBg,
  hasTranslationItems,
  getTranslationItems
}: MessageMenuBarToolbarActionProps) {
  const renderToolbar = action.renderToolbar ?? renderDefaultToolbarAction
  const renderContext: MessageMenuBarToolbarRenderContext = {
    action,
    actionContext,
    executeAction,
    hasMenuActions,
    getMenuActions,
    onMenuOpenChange,
    softHoverBg,
    hasTranslationItems,
    getTranslationItems
  }

  return renderToolbar(renderContext)
}
