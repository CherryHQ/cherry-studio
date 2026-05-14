import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { MinimaxAgentAvatar } from './avatar'
import { MinimaxAgentDark } from './dark'
import { MinimaxAgentLight } from './light'

const MinimaxAgent = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <MinimaxAgentLight className={cn('dark:hidden', className)} {...props} />
    <MinimaxAgentDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const MinimaxAgentIcon: CompoundIcon = /*#__PURE__*/ Object.assign(MinimaxAgent, {
  Light: MinimaxAgentLight,
  Dark: MinimaxAgentDark,
  Avatar: MinimaxAgentAvatar,
  colorPrimary: '#7EC7FF'
})

export default MinimaxAgentIcon
