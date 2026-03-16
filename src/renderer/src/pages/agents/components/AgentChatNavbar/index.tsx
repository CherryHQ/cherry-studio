import { NavbarHeader } from '@renderer/components/app/Navbar'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { AgentEntity } from '@renderer/types'
import { cn } from '@renderer/utils'

import AgentContent from './AgentContent'

interface Props {
  activeAgent: AgentEntity
  className?: string
}

const AgentChatNavbar = ({ activeAgent, className }: Props) => {
  const { toggleShowAssistants } = useShowAssistants()
  const { topicPosition } = useSettings()
  const { toggleShowTopics } = useShowTopics()

  useShortcut('toggle_show_assistants', toggleShowAssistants)

  useShortcut('toggle_show_topics', () => {
    if (topicPosition === 'right') {
      toggleShowTopics()
    } else {
      EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
    }
  })

  useShortcut('search_message', () => {
    SearchPopup.show()
  })

  return (
    <NavbarHeader className={cn('agent-navbar h-(--navbar-height)', className)}>
      <div className="flex h-full min-w-0 flex-1 shrink items-center overflow-auto">
        <AgentContent activeAgent={activeAgent} />
      </div>
    </NavbarHeader>
  )
}

export default AgentChatNavbar
