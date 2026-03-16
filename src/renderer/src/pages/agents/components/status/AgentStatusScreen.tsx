import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface AgentStatusScreenProps {
  icon: LucideIcon
  iconClassName: string
  title: string
  description: string
  actions: ReactNode
}

const AgentStatusScreen = ({ icon: Icon, iconClassName, title, description, actions }: AgentStatusScreenProps) => {
  return (
    <div id="content-container" className="flex h-full w-full flex-col items-center justify-center gap-4">
      <Icon size={56} strokeWidth={1.2} className={iconClassName} />
      <div className="flex flex-col items-center gap-2">
        <h3 className="m-0 font-medium text-(--color-text) text-base">{title}</h3>
        <p className="m-0 max-w-xs text-center text-(--color-text-secondary) text-sm">{description}</p>
      </div>
      <div className="flex gap-3">{actions}</div>
    </div>
  )
}

export default AgentStatusScreen
