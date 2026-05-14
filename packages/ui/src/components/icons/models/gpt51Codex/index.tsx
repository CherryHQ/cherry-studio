import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { Gpt51CodexAvatar } from './avatar'
import { Gpt51CodexDark } from './dark'
import { Gpt51CodexLight } from './light'

const Gpt51Codex = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <Gpt51CodexLight className={cn('dark:hidden', className)} {...props} />
    <Gpt51CodexDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const Gpt51CodexIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt51Codex, {
  Light: Gpt51CodexLight,
  Dark: Gpt51CodexDark,
  Avatar: Gpt51CodexAvatar,
  colorPrimary: '#000000'
})

export default Gpt51CodexIcon
