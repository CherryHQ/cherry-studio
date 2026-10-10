import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { V0Avatar } from './avatar'
import { V0Dark } from './dark'
import { V0Light } from './light'

const V0 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <V0Light {...props} className={className} />
  if (variant === 'dark') return <V0Dark {...props} className={className} />
  return (
    <>
      <V0Light className={cn('dark:hidden', className)} {...props} />
      <V0Dark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const V0Icon: CompoundIcon = /*#__PURE__*/ Object.assign(V0, {
  Avatar: V0Avatar,
  colorPrimary: '#000000'
})

export default V0Icon
