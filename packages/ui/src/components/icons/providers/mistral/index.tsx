import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MistralAvatar } from './avatar'
import { MistralDark } from './dark'
import { MistralLight } from './light'

const Mistral = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MistralLight {...props} className={className} />
  if (variant === 'dark') return <MistralDark {...props} className={className} />
  return (
    <>
      <MistralLight className={cn('dark:hidden', className)} {...props} />
      <MistralDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const MistralIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mistral, {
  Avatar: MistralAvatar,
  colorPrimary: '#FA500F'
})

export default MistralIcon
