import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Ph8Avatar } from './avatar'
import { Ph8Dark } from './dark'
import { Ph8Light } from './light'

const Ph8 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Ph8Light {...props} className={className} />
  if (variant === 'dark') return <Ph8Dark {...props} className={className} />
  return (
    <>
      <Ph8Light className={cn('dark:hidden', className)} {...props} />
      <Ph8Dark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const Ph8Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Ph8, {
  Avatar: Ph8Avatar,
  colorPrimary: '#00F0FF'
})

export default Ph8Icon
