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
  menuActions: MessageMenuBarResolvedAction[]
  onMenuOpenChange?: (open: boolean) => void
  softHoverBg: boolean
  translationItems: MessageMenuBarTranslationItem[]
}

export function MessageMenuBarToolbarAction({
  action,
  actionContext,
  executeAction,
  menuActions,
  onMenuOpenChange,
  softHoverBg,
  translationItems
}: MessageMenuBarToolbarActionProps) {
  const renderToolbar = action.renderToolbar ?? renderDefaultToolbarAction
  const renderContext: MessageMenuBarToolbarRenderContext = {
    action,
    actionContext,
    executeAction,
    menuActions,
    onMenuOpenChange,
    softHoverBg,
    translationItems
  }

  return renderToolbar(renderContext)
}
