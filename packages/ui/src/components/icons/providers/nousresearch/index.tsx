import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NousresearchAvatar } from './avatar'
import { NousresearchDark } from './dark'
import { NousresearchLight } from './light'

const Nousresearch = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NousresearchLight {...props} className={className} />
  if (variant === 'dark') return <NousresearchDark {...props} className={className} />
  return (
    <>
      <NousresearchLight className={cn('dark:hidden', className)} {...props} />
      <NousresearchDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const NousresearchIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nousresearch, {
  Avatar: NousresearchAvatar,
  colorPrimary: '#000000'
})

export default NousresearchIcon
