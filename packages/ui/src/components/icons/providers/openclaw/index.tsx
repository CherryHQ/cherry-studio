import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OpenclawAvatar } from './avatar'
import { OpenclawDark } from './dark'
import { OpenclawLight } from './light'

const Openclaw = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OpenclawLight {...props} className={className} />
  if (variant === 'dark') return <OpenclawDark {...props} className={className} />
  return (
    <>
      <OpenclawLight className={cn('dark:hidden', className)} {...props} />
      <OpenclawDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const OpenclawIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Openclaw, {
  Avatar: OpenclawAvatar,
  colorPrimary: '#FF4D4D'
})

export default OpenclawIcon
