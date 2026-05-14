import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { KwaipilotAvatar } from './avatar'
import { KwaipilotDark } from './dark'
import { KwaipilotLight } from './light'

const Kwaipilot = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <KwaipilotLight {...props} className={className} />
  if (variant === 'dark') return <KwaipilotDark {...props} className={className} />
  return (
    <>
      <KwaipilotLight className={cn('dark:hidden', className)} {...props} />
      <KwaipilotDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const KwaipilotIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Kwaipilot, {
  Avatar: KwaipilotAvatar,
  colorPrimary: '#000000'
})

export default KwaipilotIcon
