import { VStack } from '@cherrystudio/ui'
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
    <VStack gap={4} id="content-container" align="center" justify="center" className="h-full w-full">
      <Icon size={56} strokeWidth={1.2} className={iconClassName} />
      <VStack gap={2} align="center">
        <h3 className="m-0 font-medium text-(--color-text) text-base">{title}</h3>
        <p className="m-0 max-w-xs text-center text-(--color-text-secondary) text-sm">{description}</p>
      </VStack>
      {actions && <div className="flex gap-3">{actions}</div>}
    </VStack>
  )
}

export default AgentStatusScreen
