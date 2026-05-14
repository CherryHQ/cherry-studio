import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { OpenrouterAvatar } from './avatar'
import { OpenrouterDark } from './dark'
import { OpenrouterLight } from './light'

const Openrouter = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <OpenrouterLight className={cn('dark:hidden', className)} {...props} />
    <OpenrouterDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const OpenrouterIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Openrouter, {
  Light: OpenrouterLight,
  Dark: OpenrouterDark,
  Avatar: OpenrouterAvatar,
  colorPrimary: '#000000'
})

export default OpenrouterIcon
