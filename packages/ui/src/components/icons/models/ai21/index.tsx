import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Ai21Avatar } from './avatar'
import { Ai21Dark } from './dark'
import { Ai21Light } from './light'

const Ai21 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Ai21Light {...props} className={className} />
  if (variant === 'dark') return <Ai21Dark {...props} className={className} />
  return (
    <>
      <Ai21Light className={cn('dark:hidden', className)} {...props} />
      <Ai21Dark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const Ai21Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Ai21, {
  Avatar: Ai21Avatar,
  colorPrimary: '#000000'
})

export default Ai21Icon
