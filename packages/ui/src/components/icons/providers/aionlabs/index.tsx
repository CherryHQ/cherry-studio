import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { AionlabsAvatar } from './avatar'
import { AionlabsDark } from './dark'
import { AionlabsLight } from './light'

const Aionlabs = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <AionlabsLight className={cn('dark:hidden', className)} {...props} />
    <AionlabsDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const AionlabsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aionlabs, {
  Light: AionlabsLight,
  Dark: AionlabsDark,
  Avatar: AionlabsAvatar,
  colorPrimary: '#0A1B2C'
})

export default AionlabsIcon
