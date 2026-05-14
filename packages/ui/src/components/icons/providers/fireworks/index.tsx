import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { FireworksAvatar } from './avatar'
import { FireworksDark } from './dark'
import { FireworksLight } from './light'

const Fireworks = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <FireworksLight className={cn('dark:hidden', className)} {...props} />
    <FireworksDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const FireworksIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Fireworks, {
  Light: FireworksLight,
  Dark: FireworksDark,
  Avatar: FireworksAvatar,
  colorPrimary: '#5019C5'
})

export default FireworksIcon
