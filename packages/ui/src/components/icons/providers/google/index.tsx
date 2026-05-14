import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GoogleAvatar } from './avatar'
import { GoogleDark } from './dark'
import { GoogleLight } from './light'

const Google = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GoogleLight className={cn('dark:hidden', className)} {...props} />
    <GoogleDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GoogleIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Google, {
  Light: GoogleLight,
  Dark: GoogleDark,
  Avatar: GoogleAvatar,
  colorPrimary: '#3086FF'
})

export default GoogleIcon
