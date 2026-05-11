import { EmptyState } from '@renderer/components/chat'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface AgentStatusScreenProps {
  icon: LucideIcon
  iconClassName: string
  title: string
  description: string
  actions?: ReactNode
}

const AgentStatusScreen = ({ icon: Icon, iconClassName, title, description, actions }: AgentStatusScreenProps) => {
  return (
    <EmptyState
      id="content-container"
      icon={Icon}
      iconClassName={iconClassName}
      iconSize={56}
      iconStrokeWidth={1.2}
      title={title}
      description={description}
      actions={actions}
    />
  )
}

export default AgentStatusScreen
