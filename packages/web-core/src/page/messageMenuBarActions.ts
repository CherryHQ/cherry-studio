// Wraps the desktop message actions: reading a message aloud needs the desktop's speech services.
import {
  type MessageMenuBarActionContext,
  type MessageMenuBarResolvedToolbarAction,
  resolveMessageMenuBarToolbarActions as resolveDesktopToolbarActions
} from '@renderer/components/chat/messages/frame/messageMenuBarActions'

export * from '@renderer/components/chat/messages/frame/messageMenuBarActions'

export function resolveMessageMenuBarToolbarActions(
  context: MessageMenuBarActionContext
): MessageMenuBarResolvedToolbarAction[] {
  return resolveDesktopToolbarActions(context).filter(({ id }) => id !== 'read-aloud')
}
