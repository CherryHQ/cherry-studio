import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { ExaAvatar } from './avatar'
import { ExaDark } from './dark'
import { ExaLight } from './light'

const Exa = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <ExaLight className={cn('dark:hidden', className)} {...props} />
    <ExaDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const ExaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Exa, {
  Light: ExaLight,
  Dark: ExaDark,
  Avatar: ExaAvatar,
  colorPrimary: '#1F40ED'
})

export default ExaIcon
