import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GensparkAvatar } from './avatar'
import { GensparkDark } from './dark'
import { GensparkLight } from './light'

const Genspark = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GensparkLight className={cn('dark:hidden', className)} {...props} />
    <GensparkDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GensparkIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Genspark, {
  Light: GensparkLight,
  Dark: GensparkDark,
  Avatar: GensparkAvatar,
  colorPrimary: '#000000'
})

export default GensparkIcon
