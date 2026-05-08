import { cn } from '@cherrystudio/ui/lib/utils'
import type { ComponentPropsWithoutRef } from 'react'

const NavbarIcon = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <div
      className={cn(
        'flex h-[30px] cursor-pointer flex-row items-center justify-center rounded-[8px] px-[7px] transition-all duration-200 ease-in-out [-webkit-app-region:none] hover:bg-[var(--color-background-mute)] hover:text-[var(--color-icon-white)] [&_.anticon]:text-[16px] [&_.anticon]:text-[var(--color-icon)] [&_.icon-a-addchat]:text-[20px] [&_.icon-a-darkmode]:text-[20px] [&_.icon-appstore]:text-[20px] [&_.iconfont]:text-[18px] [&_.iconfont]:text-[var(--color-icon)]',
        className
      )}
      {...props}
    />
  )
}

export default NavbarIcon
