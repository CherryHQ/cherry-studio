import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { Gpt51ChatAvatar } from './avatar'
import { Gpt51ChatDark } from './dark'
import { Gpt51ChatLight } from './light'

const Gpt51Chat = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <Gpt51ChatLight className={cn('dark:hidden', className)} {...props} />
    <Gpt51ChatDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const Gpt51ChatIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt51Chat, {
  Light: Gpt51ChatLight,
  Dark: Gpt51ChatDark,
  Avatar: Gpt51ChatAvatar,
  colorPrimary: '#000000'
})

export default Gpt51ChatIcon
