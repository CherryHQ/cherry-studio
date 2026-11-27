import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { InklingAvatar } from './avatar'
import { InklingDark } from './dark'
import { InklingLight } from './light'

const Inkling = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <InklingLight {...props} className={className} />
  if (variant === 'dark') return <InklingDark {...props} className={className} />
  return (
    <>
      <InklingLight className={cn('dark:hidden', className)} {...props} />
      <InklingDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const InklingIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Inkling, {
  Avatar: InklingAvatar,
  colorPrimary: '#000000'
})

export default InklingIcon
