import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { Gpt5ChatAvatar } from './avatar'
import { Gpt5ChatDark } from './dark'
import { Gpt5ChatLight } from './light'

const Gpt5Chat = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <Gpt5ChatLight className={cn('dark:hidden', className)} {...props} />
    <Gpt5ChatDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const Gpt5ChatIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5Chat, {
  Light: Gpt5ChatLight,
  Dark: Gpt5ChatDark,
  Avatar: Gpt5ChatAvatar,
  colorPrimary: '#000000'
})

export default Gpt5ChatIcon
