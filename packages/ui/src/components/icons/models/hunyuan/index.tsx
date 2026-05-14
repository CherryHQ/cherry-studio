import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { HunyuanAvatar } from './avatar'
import { HunyuanDark } from './dark'
import { HunyuanLight } from './light'

const Hunyuan = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <HunyuanLight className={cn('dark:hidden', className)} {...props} />
    <HunyuanDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const HunyuanIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Hunyuan, {
  Light: HunyuanLight,
  Dark: HunyuanDark,
  Avatar: HunyuanAvatar,
  colorPrimary: '#0054E0'
})

export default HunyuanIcon
