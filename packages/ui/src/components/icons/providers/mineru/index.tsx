import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { MineruAvatar } from './avatar'
import { MineruDark } from './dark'
import { MineruLight } from './light'

const Mineru = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <MineruLight className={cn('dark:hidden', className)} {...props} />
    <MineruDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const MineruIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mineru, {
  Light: MineruLight,
  Dark: MineruDark,
  Avatar: MineruAvatar,
  colorPrimary: '#000000'
})

export default MineruIcon
