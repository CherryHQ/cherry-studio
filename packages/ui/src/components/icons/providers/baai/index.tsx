import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { BaaiAvatar } from './avatar'
import { BaaiDark } from './dark'
import { BaaiLight } from './light'

const Baai = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <BaaiLight className={cn('dark:hidden', className)} {...props} />
    <BaaiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const BaaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Baai, {
  Light: BaaiLight,
  Dark: BaaiDark,
  Avatar: BaaiAvatar,
  colorPrimary: '#000000'
})

export default BaaiIcon
