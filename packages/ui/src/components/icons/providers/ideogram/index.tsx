import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { IdeogramAvatar } from './avatar'
import { IdeogramDark } from './dark'
import { IdeogramLight } from './light'

const Ideogram = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <IdeogramLight className={cn('dark:hidden', className)} {...props} />
    <IdeogramDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const IdeogramIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ideogram, {
  Light: IdeogramLight,
  Dark: IdeogramDark,
  Avatar: IdeogramAvatar,
  colorPrimary: '#000000'
})

export default IdeogramIcon
