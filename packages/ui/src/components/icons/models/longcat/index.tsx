import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LongcatAvatar } from './avatar'
import { LongcatDark } from './dark'
import { LongcatLight } from './light'

const Longcat = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LongcatLight {...props} className={className} />

  if (variant === 'dark') return <LongcatDark {...props} className={className} />

  return (
    <>
      <LongcatLight className={cn('dark:hidden', className)} {...props} />
      <LongcatDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const LongcatIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Longcat, {
  Avatar: LongcatAvatar,
  colorPrimary: '#ecfcf0'
})

export default LongcatIcon
