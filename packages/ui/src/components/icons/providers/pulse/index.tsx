import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { PulseAvatar } from './avatar'
import { PulseDark } from './dark'
import { PulseLight } from './light'

const Pulse = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <PulseLight className={cn('dark:hidden', className)} {...props} />
    <PulseDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const PulseIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Pulse, {
  Light: PulseLight,
  Dark: PulseDark,
  Avatar: PulseAvatar,
  colorPrimary: '#302F7D'
})

export default PulseIcon
