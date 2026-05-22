import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MacosAvatar } from './avatar'
import { MacosDark } from './dark'
import { MacosLight } from './light'

const Macos = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MacosLight {...props} className={className} />
  if (variant === 'dark') return <MacosDark {...props} className={className} />
  return (
    <>
      <MacosLight className={cn(className, 'dark:hidden')} {...props} />
      <MacosDark className={cn(className, 'hidden dark:block')} {...props} />
    </>
  )
}

export const MacosIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Macos, {
  Avatar: MacosAvatar,
  colorPrimary: '#000000'
})

export default MacosIcon
