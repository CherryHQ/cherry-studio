import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { OpenaiAvatar } from './avatar'
import { OpenaiDark } from './dark'
import { OpenaiLight } from './light'

const Openai = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <OpenaiLight className={cn('dark:hidden', className)} {...props} />
    <OpenaiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const OpenaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Openai, {
  Light: OpenaiLight,
  Dark: OpenaiDark,
  Avatar: OpenaiAvatar,
  colorPrimary: '#000000'
})

export default OpenaiIcon
