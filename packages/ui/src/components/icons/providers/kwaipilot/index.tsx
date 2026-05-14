import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { KwaipilotAvatar } from './avatar'
import { KwaipilotDark } from './dark'
import { KwaipilotLight } from './light'

const Kwaipilot = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <KwaipilotLight className={cn('dark:hidden', className)} {...props} />
    <KwaipilotDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const KwaipilotIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Kwaipilot, {
  Light: KwaipilotLight,
  Dark: KwaipilotDark,
  Avatar: KwaipilotAvatar,
  colorPrimary: '#000000'
})

export default KwaipilotIcon
