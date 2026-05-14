import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { CodegeexAvatar } from './avatar'
import { CodegeexDark } from './dark'
import { CodegeexLight } from './light'

const Codegeex = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <CodegeexLight className={cn('dark:hidden', className)} {...props} />
    <CodegeexDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const CodegeexIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Codegeex, {
  Light: CodegeexLight,
  Dark: CodegeexDark,
  Avatar: CodegeexAvatar,
  colorPrimary: '#171E1E'
})

export default CodegeexIcon
