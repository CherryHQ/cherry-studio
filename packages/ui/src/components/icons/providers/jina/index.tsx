import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { JinaAvatar } from './avatar'
import { JinaDark } from './dark'
import { JinaLight } from './light'

const Jina = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <JinaLight className={cn('dark:hidden', className)} {...props} />
    <JinaDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const JinaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Jina, {
  Light: JinaLight,
  Dark: JinaDark,
  Avatar: JinaAvatar,
  colorPrimary: '#EB6161'
})

export default JinaIcon
