import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SofyaAvatar } from './avatar'
import { SofyaDark } from './dark'
import { SofyaLight } from './light'

const Sofya = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SofyaLight {...props} className={className} />
  if (variant === 'dark') return <SofyaDark {...props} className={className} />
  return (
    <>
      <SofyaLight className={cn('dark:hidden', className)} {...props} />
      <SofyaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const SofyaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sofya, {
  Avatar: SofyaAvatar,
  colorPrimary: '#3A4A7A'
})

export default SofyaIcon
