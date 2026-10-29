import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SuperbotAvatar } from './avatar'
import { SuperbotDark } from './dark'
import { SuperbotLight } from './light'

const Superbot = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SuperbotLight {...props} className={className} />
  if (variant === 'dark') return <SuperbotDark {...props} className={className} />
  return (
    <>
      <SuperbotLight className={cn('dark:hidden', className)} {...props} />
      <SuperbotDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const SuperbotIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Superbot, {
  Avatar: SuperbotAvatar,
  colorPrimary: '#000000'
})

export default SuperbotIcon
