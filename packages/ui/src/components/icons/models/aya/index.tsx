import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AyaAvatar } from './avatar'
import { AyaDark } from './dark'
import { AyaLight } from './light'

const Aya = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AyaLight {...props} className={className} />
  if (variant === 'dark') return <AyaDark {...props} className={className} />
  return (
    <>
      <AyaLight className={cn('dark:hidden', className)} {...props} />
      <AyaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AyaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aya, {
  Avatar: AyaAvatar,
  colorPrimary: '#010201'
})

export default AyaIcon
