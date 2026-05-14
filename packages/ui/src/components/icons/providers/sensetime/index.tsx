import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SensetimeAvatar } from './avatar'
import { SensetimeDark } from './dark'
import { SensetimeLight } from './light'

const Sensetime = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SensetimeLight {...props} className={className} />
  if (variant === 'dark') return <SensetimeDark {...props} className={className} />
  return (
    <>
      <SensetimeLight className={cn('dark:hidden', className)} {...props} />
      <SensetimeDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const SensetimeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sensetime, {
  Avatar: SensetimeAvatar,
  colorPrimary: '#7680F8'
})

export default SensetimeIcon
