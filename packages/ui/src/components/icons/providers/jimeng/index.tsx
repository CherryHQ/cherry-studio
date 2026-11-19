import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { JimengAvatar } from './avatar'
import { JimengDark } from './dark'
import { JimengLight } from './light'

const Jimeng = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <JimengLight {...props} className={className} />
  if (variant === 'dark') return <JimengDark {...props} className={className} />
  return (
    <>
      <JimengLight className={cn('dark:hidden', className)} {...props} />
      <JimengDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const JimengIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Jimeng, {
  Avatar: JimengAvatar,
  colorPrimary: '#000000'
})

export default JimengIcon
