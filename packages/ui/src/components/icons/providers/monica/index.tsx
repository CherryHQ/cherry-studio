import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { MonicaAvatar } from './avatar'
import { MonicaDark } from './dark'
import { MonicaLight } from './light'

const Monica = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <MonicaLight className={cn('dark:hidden', className)} {...props} />
    <MonicaDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const MonicaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Monica, {
  Light: MonicaLight,
  Dark: MonicaDark,
  Avatar: MonicaAvatar,
  colorPrimary: '#1E1E1E'
})

export default MonicaIcon
