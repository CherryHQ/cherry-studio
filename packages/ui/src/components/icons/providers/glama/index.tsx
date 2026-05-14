import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GlamaAvatar } from './avatar'
import { GlamaDark } from './dark'
import { GlamaLight } from './light'

const Glama = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GlamaLight className={cn('dark:hidden', className)} {...props} />
    <GlamaDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GlamaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Glama, {
  Light: GlamaLight,
  Dark: GlamaDark,
  Avatar: GlamaAvatar,
  colorPrimary: '#000000'
})

export default GlamaIcon
