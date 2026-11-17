import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MinTop3Avatar } from './avatar'
import { MinTop3Dark } from './dark'
import { MinTop3Light } from './light'

const MinTop3 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MinTop3Light {...props} className={className} />
  if (variant === 'dark') return <MinTop3Dark {...props} className={className} />
  return (
    <>
      <MinTop3Light className={cn('dark:hidden', className)} {...props} />
      <MinTop3Dark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const MinTop3Icon: CompoundIcon = /*#__PURE__*/ Object.assign(MinTop3, {
  Avatar: MinTop3Avatar,
  colorPrimary: '#FFF0A0'
})

export default MinTop3Icon
