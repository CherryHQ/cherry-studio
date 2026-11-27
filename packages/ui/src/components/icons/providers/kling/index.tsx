import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { KlingAvatar } from './avatar'
import { KlingDark } from './dark'
import { KlingLight } from './light'

const Kling = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <KlingLight {...props} className={className} />
  if (variant === 'dark') return <KlingDark {...props} className={className} />
  return (
    <>
      <KlingLight className={cn('dark:hidden', className)} {...props} />
      <KlingDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const KlingIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Kling, {
  Avatar: KlingAvatar,
  colorPrimary: '#000000'
})

export default KlingIcon
