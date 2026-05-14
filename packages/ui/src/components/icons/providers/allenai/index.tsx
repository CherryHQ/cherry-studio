import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { AllenaiAvatar } from './avatar'
import { AllenaiDark } from './dark'
import { AllenaiLight } from './light'

const Allenai = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <AllenaiLight className={cn('dark:hidden', className)} {...props} />
    <AllenaiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const AllenaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Allenai, {
  Light: AllenaiLight,
  Dark: AllenaiDark,
  Avatar: AllenaiAvatar,
  colorPrimary: '#F8F0E9'
})

export default AllenaiIcon
