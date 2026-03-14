import type { LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
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
    <motion.div
      className="flex h-full w-full flex-col items-center justify-center gap-4"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}>
      <Icon size={56} strokeWidth={1.2} className={iconClassName} />
      <div className="flex flex-col items-center gap-2">
        <h3 className="m-0 font-medium text-(--color-text) text-base">{title}</h3>
        <p className="m-0 max-w-xs text-center text-(--color-text-secondary) text-sm">{description}</p>
      </div>
      <div className="flex gap-3">{actions}</div>
    </motion.div>
  )
}

export default AgentStatusScreen
