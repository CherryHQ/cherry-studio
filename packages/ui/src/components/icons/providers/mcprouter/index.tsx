import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { McprouterAvatar } from './avatar'
import { McprouterDark } from './dark'
import { McprouterLight } from './light'

const Mcprouter = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <McprouterLight className={cn('dark:hidden', className)} {...props} />
    <McprouterDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const McprouterIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mcprouter, {
  Light: McprouterLight,
  Dark: McprouterDark,
  Avatar: McprouterAvatar,
  colorPrimary: '#004AAD'
})

export default McprouterIcon
