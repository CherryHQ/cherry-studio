import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { BingAvatar } from './avatar'
import { BingDark } from './dark'
import { BingLight } from './light'

const Bing = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <BingLight className={cn('dark:hidden', className)} {...props} />
    <BingDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const BingIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bing, {
  Light: BingLight,
  Dark: BingDark,
  Avatar: BingAvatar,
  colorPrimary: '#000000'
})

export default BingIcon
