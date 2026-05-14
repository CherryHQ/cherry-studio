import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SoraAvatar } from './avatar'
import { SoraDark } from './dark'
import { SoraLight } from './light'

const Sora = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SoraLight {...props} className={className} />
  if (variant === 'dark') return <SoraDark {...props} className={className} />
  return (
    <>
      <SoraLight className={cn('dark:hidden', className)} {...props} />
      <SoraDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const SoraIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sora, {
  Avatar: SoraAvatar,
  colorPrimary: '#000000'
})

export default SoraIcon
