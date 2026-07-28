import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { ComponentProps } from 'react'

type NavbarIconProps = Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & {
  active?: boolean
  tone?: 'default' | 'conversation'
}

const NavbarIcon = ({ active, className, tone = 'default', type = 'button', ...props }: NavbarIconProps) => {
  const conversation = tone === 'conversation'

  return (
    <Button
      type={type}
      variant={conversation && active ? 'secondary' : 'ghost'}
      size="icon-navbar"
      data-active={active || undefined}
      className={cn(
        conversation
          ? 'text-foreground/70! duration-150 ease-in-out [-webkit-app-region:none] hover:bg-accent/60 hover:text-foreground! data-[active=true]:bg-secondary data-[state=open]:bg-secondary data-[active=true]:text-secondary-foreground! data-[state=open]:text-secondary-foreground! [&_.lucide:not(.lucide-custom)]:text-current!'
          : 'text-foreground/70! duration-200 ease-in-out [-webkit-app-region:none] hover:bg-muted hover:text-foreground',
        conversation && active && 'bg-secondary text-secondary-foreground!',
        className
      )}
      {...props}
    />
  )
}

export default NavbarIcon
