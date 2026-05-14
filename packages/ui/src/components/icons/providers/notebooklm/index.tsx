import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { NotebooklmAvatar } from './avatar'
import { NotebooklmDark } from './dark'
import { NotebooklmLight } from './light'

const Notebooklm = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <NotebooklmLight className={cn('dark:hidden', className)} {...props} />
    <NotebooklmDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const NotebooklmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Notebooklm, {
  Light: NotebooklmLight,
  Dark: NotebooklmDark,
  Avatar: NotebooklmAvatar,
  colorPrimary: '#000000'
})

export default NotebooklmIcon
