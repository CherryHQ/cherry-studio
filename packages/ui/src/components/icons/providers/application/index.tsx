import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { ApplicationAvatar } from './avatar'
import { ApplicationDark } from './dark'
import { ApplicationLight } from './light'

const Application = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <ApplicationLight className={cn('dark:hidden', className)} {...props} />
    <ApplicationDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const ApplicationIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Application, {
  Light: ApplicationLight,
  Dark: ApplicationDark,
  Avatar: ApplicationAvatar,
  colorPrimary: '#2BA471'
})

export default ApplicationIcon
