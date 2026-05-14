import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { WenxinAvatar } from './avatar'
import { WenxinDark } from './dark'
import { WenxinLight } from './light'

const Wenxin = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <WenxinLight className={cn('dark:hidden', className)} {...props} />
    <WenxinDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const WenxinIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Wenxin, {
  Light: WenxinLight,
  Dark: WenxinDark,
  Avatar: WenxinAvatar,
  colorPrimary: '#012F8D'
})

export default WenxinIcon
