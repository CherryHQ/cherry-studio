import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { FlowithAvatar } from './avatar'
import { FlowithDark } from './dark'
import { FlowithLight } from './light'

const Flowith = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <FlowithLight {...props} className={className} />
  if (variant === 'dark') return <FlowithDark {...props} className={className} />
  return (
    <>
      <FlowithLight className={cn('dark:hidden', className)} {...props} />
      <FlowithDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const FlowithIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Flowith, {
  Avatar: FlowithAvatar,
  colorPrimary: '#000000'
})

export default FlowithIcon
