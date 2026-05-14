import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { MistralAvatar } from './avatar'
import { MistralDark } from './dark'
import { MistralLight } from './light'

const Mistral = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <MistralLight className={cn('dark:hidden', className)} {...props} />
    <MistralDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const MistralIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mistral, {
  Light: MistralLight,
  Dark: MistralDark,
  Avatar: MistralAvatar,
  colorPrimary: '#FA500F'
})

export default MistralIcon
