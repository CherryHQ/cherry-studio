import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { Gpt5NanoAvatar } from './avatar'
import { Gpt5NanoDark } from './dark'
import { Gpt5NanoLight } from './light'

const Gpt5Nano = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <Gpt5NanoLight className={cn('dark:hidden', className)} {...props} />
    <Gpt5NanoDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const Gpt5NanoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5Nano, {
  Light: Gpt5NanoLight,
  Dark: Gpt5NanoDark,
  Avatar: Gpt5NanoAvatar,
  colorPrimary: '#000000'
})

export default Gpt5NanoIcon
