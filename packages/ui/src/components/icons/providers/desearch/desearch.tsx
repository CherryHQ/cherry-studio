import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DesearchAvatar } from './avatar'
import { DesearchDark } from './dark'
import { DesearchLight } from './light'

const Desearch = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DesearchLight {...props} className={className} />
  if (variant === 'dark') return <DesearchDark {...props} className={className} />
  return (
    <>
      <DesearchLight className={cn('dark:hidden', className)} {...props} />
      <DesearchDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const DesearchIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Desearch, {
  Avatar: DesearchAvatar,
  colorPrimary: '#000000'
})

export default DesearchIcon
