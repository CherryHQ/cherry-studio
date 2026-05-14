import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { Gpt5MiniAvatar } from './avatar'
import { Gpt5MiniDark } from './dark'
import { Gpt5MiniLight } from './light'

const Gpt5Mini = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <Gpt5MiniLight className={cn('dark:hidden', className)} {...props} />
    <Gpt5MiniDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const Gpt5MiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5Mini, {
  Light: Gpt5MiniLight,
  Dark: Gpt5MiniDark,
  Avatar: Gpt5MiniAvatar,
  colorPrimary: '#000000'
})

export default Gpt5MiniIcon
