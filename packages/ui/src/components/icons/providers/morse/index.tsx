import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MorseAvatar } from './avatar'
import { MorseDark } from './dark'
import { MorseLight } from './light'

const Morse = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MorseLight {...props} className={className} />
  if (variant === 'dark') return <MorseDark {...props} className={className} />
  return (
    <>
      <MorseLight className={cn('dark:hidden', className)} {...props} />
      <MorseDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const MorseIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Morse, {
  Avatar: MorseAvatar,
  colorPrimary: '#000000'
})

export default MorseIcon
