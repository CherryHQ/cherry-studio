import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { DolaAvatar } from './avatar'
import { DolaDark } from './dark'
import { DolaLight } from './light'

const Dola = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <DolaLight className={cn('dark:hidden', className)} {...props} />
    <DolaDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const DolaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dola, {
  Light: DolaLight,
  Dark: DolaDark,
  Avatar: DolaAvatar,
  colorPrimary: '#000000'
})

export default DolaIcon
