import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ElevenlabsAvatar } from './avatar'
import { ElevenlabsDark } from './dark'
import { ElevenlabsLight } from './light'

const Elevenlabs = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ElevenlabsLight {...props} className={className} />
  if (variant === 'dark') return <ElevenlabsDark {...props} className={className} />
  return (
    <>
      <ElevenlabsLight className={cn('dark:hidden', className)} {...props} />
      <ElevenlabsDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ElevenlabsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Elevenlabs, {
  Avatar: ElevenlabsAvatar,
  colorPrimary: '#000000'
})

export default ElevenlabsIcon
