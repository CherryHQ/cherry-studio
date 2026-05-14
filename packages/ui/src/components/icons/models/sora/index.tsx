import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { SoraAvatar } from './avatar'
import { SoraDark } from './dark'
import { SoraLight } from './light'

const Sora = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <SoraLight className={cn('dark:hidden', className)} {...props} />
    <SoraDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const SoraIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sora, {
  Light: SoraLight,
  Dark: SoraDark,
  Avatar: SoraAvatar,
  colorPrimary: '#000000'
})

export default SoraIcon
