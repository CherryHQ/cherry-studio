import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { O3Avatar } from './avatar'
import { O3Dark } from './dark'
import { O3Light } from './light'

const O3 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <O3Light {...props} className={className} />
  if (variant === 'dark') return <O3Dark {...props} className={className} />
  return (
    <>
      <O3Light className={cn('dark:hidden', className)} {...props} />
      <O3Dark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const O3Icon: CompoundIcon = /*#__PURE__*/ Object.assign(O3, {
  Avatar: O3Avatar,
  colorPrimary: '#F5F6FC'
})

export default O3Icon
