import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MinimaxAgentAvatar } from './avatar'
import { MinimaxAgentDark } from './dark'
import { MinimaxAgentLight } from './light'

const MinimaxAgent = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MinimaxAgentLight {...props} className={className} />
  if (variant === 'dark') return <MinimaxAgentDark {...props} className={className} />
  return (
    <>
      <MinimaxAgentLight className={cn('dark:hidden', className)} {...props} />
      <MinimaxAgentDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const MinimaxAgentIcon: CompoundIcon = /*#__PURE__*/ Object.assign(MinimaxAgent, {
  Avatar: MinimaxAgentAvatar,
  colorPrimary: '#7EC7FF'
})

export default MinimaxAgentIcon
