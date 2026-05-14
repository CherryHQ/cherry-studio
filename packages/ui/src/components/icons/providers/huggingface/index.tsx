import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { HuggingfaceAvatar } from './avatar'
import { HuggingfaceDark } from './dark'
import { HuggingfaceLight } from './light'

const Huggingface = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <HuggingfaceLight className={cn('dark:hidden', className)} {...props} />
    <HuggingfaceDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const HuggingfaceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Huggingface, {
  Light: HuggingfaceLight,
  Dark: HuggingfaceDark,
  Avatar: HuggingfaceAvatar,
  colorPrimary: '#FF9D0B'
})

export default HuggingfaceIcon
