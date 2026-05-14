import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { NamiAiAvatar } from './avatar'
import { NamiAiDark } from './dark'
import { NamiAiLight } from './light'

const NamiAi = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <NamiAiLight className={cn('dark:hidden', className)} {...props} />
    <NamiAiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const NamiAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(NamiAi, {
  Light: NamiAiLight,
  Dark: NamiAiDark,
  Avatar: NamiAiAvatar,
  colorPrimary: '#000000'
})

export default NamiAiIcon
