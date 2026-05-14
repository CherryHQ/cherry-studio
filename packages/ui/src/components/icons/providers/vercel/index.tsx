import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { VercelAvatar } from './avatar'
import { VercelDark } from './dark'
import { VercelLight } from './light'

const Vercel = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <VercelLight className={cn('dark:hidden', className)} {...props} />
    <VercelDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const VercelIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Vercel, {
  Light: VercelLight,
  Dark: VercelDark,
  Avatar: VercelAvatar,
  colorPrimary: '#000000'
})

export default VercelIcon
