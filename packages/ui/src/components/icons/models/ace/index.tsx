import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AceAvatar } from './avatar'
import { AceDark } from './dark'
import { AceLight } from './light'

const Ace = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AceLight {...props} className={className} />
  if (variant === 'dark') return <AceDark {...props} className={className} />
  return (
    <>
      <AceLight className={cn('dark:hidden', className)} {...props} />
      <AceDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ace, {
  Avatar: AceAvatar,
  colorPrimary: '#000000'
})

export default AceIcon
