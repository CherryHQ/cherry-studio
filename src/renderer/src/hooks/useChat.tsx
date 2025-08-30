import { useNavbarPosition, useSettings } from './useSettings'
import { useShowAssistants } from './useStore'

export const useChatMaxWidth = () => {
  const { showTopics, topicPosition } = useSettings()
  const { isLeftNavbar } = useNavbarPosition()
  const { showAssistants } = useShowAssistants()
  const showRightTopics = showTopics && topicPosition === 'right'
  const minusAssistantsWidth = showAssistants ? '- var(--assistants-width)' : ''
  const minusRightTopicsWidth = showRightTopics ? '- var(--assistants-width)' : ''
  const sidebarWidth = isLeftNavbar ? '- var(--sidebar-width)' : ''
  return `calc(100vw ${sidebarWidth} ${minusAssistantsWidth} ${minusRightTopicsWidth})`
}
