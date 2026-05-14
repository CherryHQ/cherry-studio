import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { ElevenlabsAvatar } from './avatar'
import { ElevenlabsDark } from './dark'
import { ElevenlabsLight } from './light'

const Elevenlabs = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <ElevenlabsLight className={cn('dark:hidden', className)} {...props} />
    <ElevenlabsDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const ElevenlabsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Elevenlabs, {
  Light: ElevenlabsLight,
  Dark: ElevenlabsDark,
  Avatar: ElevenlabsAvatar,
  colorPrimary: '#000000'
})

export default ElevenlabsIcon
