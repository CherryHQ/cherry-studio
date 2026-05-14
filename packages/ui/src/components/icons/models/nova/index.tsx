import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { NovaAvatar } from './avatar'
import { NovaDark } from './dark'
import { NovaLight } from './light'

const Nova = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <NovaLight className={cn('dark:hidden', className)} {...props} />
    <NovaDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const NovaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nova, {
  Light: NovaLight,
  Dark: NovaDark,
  Avatar: NovaAvatar,
  colorPrimary: '#000000'
})

export default NovaIcon
