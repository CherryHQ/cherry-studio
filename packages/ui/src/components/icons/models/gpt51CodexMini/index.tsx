import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { Gpt51CodexMiniAvatar } from './avatar'
import { Gpt51CodexMiniDark } from './dark'
import { Gpt51CodexMiniLight } from './light'

const Gpt51CodexMini = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <Gpt51CodexMiniLight className={cn('dark:hidden', className)} {...props} />
    <Gpt51CodexMiniDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const Gpt51CodexMiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt51CodexMini, {
  Light: Gpt51CodexMiniLight,
  Dark: Gpt51CodexMiniDark,
  Avatar: Gpt51CodexMiniAvatar,
  colorPrimary: '#000000'
})

export default Gpt51CodexMiniIcon
