import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { MetaAvatar } from './avatar'
import { MetaDark } from './dark'
import { MetaLight } from './light'

const Meta = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <MetaLight className={cn('dark:hidden', className)} {...props} />
    <MetaDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const MetaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Meta, {
  Light: MetaLight,
  Dark: MetaDark,
  Avatar: MetaAvatar,
  colorPrimary: '#0081FB'
})

export default MetaIcon
