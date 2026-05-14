import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { CherryinAvatar } from './avatar'
import { CherryinDark } from './dark'
import { CherryinLight } from './light'

const Cherryin = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <CherryinLight className={cn('dark:hidden', className)} {...props} />
    <CherryinDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const CherryinIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cherryin, {
  Light: CherryinLight,
  Dark: CherryinDark,
  Avatar: CherryinAvatar,
  colorPrimary: '#FF5F5F'
})

export default CherryinIcon
