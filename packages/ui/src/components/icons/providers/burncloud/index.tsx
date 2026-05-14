import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { BurncloudAvatar } from './avatar'
import { BurncloudDark } from './dark'
import { BurncloudLight } from './light'

const Burncloud = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <BurncloudLight className={cn('dark:hidden', className)} {...props} />
    <BurncloudDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const BurncloudIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Burncloud, {
  Light: BurncloudLight,
  Dark: BurncloudDark,
  Avatar: BurncloudAvatar,
  colorPrimary: '#000000'
})

export default BurncloudIcon
