import { cn } from '@cherrystudio/ui/lib/utils'
import type { FC, ReactNode } from 'react'

import { useWebSearchSettingsNav } from './Layout/WebSearchSettingsLayout'

interface NavItemProps {
  to: string
  activePaths?: string[]
  icon?: ReactNode
  children: ReactNode
}

const NavItem: FC<NavItemProps> = ({ to, activePaths, icon, children }) => {
  const { isActive, navigateTo } = useWebSearchSettingsNav()
  const paths = activePaths && activePaths.length > 0 ? activePaths : [to]
  const active = paths.some(isActive)

  return (
    <div
      className={cn(
        'flex cursor-pointer flex-row items-center gap-2 rounded-3xs p-2 hover:bg-ghost-hover',
        active && 'bg-ghost-hover'
      )}
      onClick={() => navigateTo(to)}>
      {icon}
      {children}
    </div>
  )
}

export default NavItem
