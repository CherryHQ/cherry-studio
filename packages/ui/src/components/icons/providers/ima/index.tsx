import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ImaAvatar } from './avatar'
import { ImaDark } from './dark'
import { ImaLight } from './light'

const Ima = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ImaLight {...props} className={className} />
  if (variant === 'dark') return <ImaDark {...props} className={className} />
  return (
    <>
      <ImaLight className={cn('dark:hidden', className)} {...props} />
      <ImaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ImaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ima, {
  Avatar: ImaAvatar,
  colorPrimary: '#000000'
})

export default ImaIcon
