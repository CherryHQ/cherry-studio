import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { LingxiAvatar } from './avatar'
import { LingxiDark } from './dark'
import { LingxiLight } from './light'

const Lingxi = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <LingxiLight className={cn('dark:hidden', className)} {...props} />
    <LingxiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const LingxiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lingxi, {
  Light: LingxiLight,
  Dark: LingxiDark,
  Avatar: LingxiAvatar,
  colorPrimary: '#000000'
})

export default LingxiIcon
