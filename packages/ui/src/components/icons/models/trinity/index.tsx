import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { TrinityAvatar } from './avatar'
import { TrinityDark } from './dark'
import { TrinityLight } from './light'

const Trinity = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <TrinityLight className={cn('dark:hidden', className)} {...props} />
    <TrinityDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const TrinityIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Trinity, {
  Light: TrinityLight,
  Dark: TrinityDark,
  Avatar: TrinityAvatar,
  colorPrimary: '#000000'
})

export default TrinityIcon
