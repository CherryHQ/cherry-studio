import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { BaichuanAvatar } from './avatar'
import { BaichuanDark } from './dark'
import { BaichuanLight } from './light'

const Baichuan = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <BaichuanLight className={cn('dark:hidden', className)} {...props} />
    <BaichuanDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const BaichuanIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Baichuan, {
  Light: BaichuanLight,
  Dark: BaichuanDark,
  Avatar: BaichuanAvatar,
  colorPrimary: '#000000'
})

export default BaichuanIcon
