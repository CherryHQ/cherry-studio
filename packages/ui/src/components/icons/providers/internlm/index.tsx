import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { InternlmAvatar } from './avatar'
import { InternlmDark } from './dark'
import { InternlmLight } from './light'

const Internlm = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <InternlmLight {...props} className={className} />
  if (variant === 'dark') return <InternlmDark {...props} className={className} />
  return (
    <>
      <InternlmLight className={cn('dark:hidden', className)} {...props} />
      <InternlmDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const InternlmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Internlm, {
  Avatar: InternlmAvatar,
  colorPrimary: '#858599'
})

export default InternlmIcon
