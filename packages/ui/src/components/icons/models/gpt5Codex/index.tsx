import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { Gpt5CodexAvatar } from './avatar'
import { Gpt5CodexDark } from './dark'
import { Gpt5CodexLight } from './light'

const Gpt5Codex = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <Gpt5CodexLight className={cn('dark:hidden', className)} {...props} />
    <Gpt5CodexDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const Gpt5CodexIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5Codex, {
  Light: Gpt5CodexLight,
  Dark: Gpt5CodexDark,
  Avatar: Gpt5CodexAvatar,
  colorPrimary: '#000000'
})

export default Gpt5CodexIcon
