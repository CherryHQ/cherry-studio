import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { NeteaseYoudaoAvatar } from './avatar'
import { NeteaseYoudaoDark } from './dark'
import { NeteaseYoudaoLight } from './light'

const NeteaseYoudao = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <NeteaseYoudaoLight className={cn('dark:hidden', className)} {...props} />
    <NeteaseYoudaoDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const NeteaseYoudaoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(NeteaseYoudao, {
  Light: NeteaseYoudaoLight,
  Dark: NeteaseYoudaoDark,
  Avatar: NeteaseYoudaoAvatar,
  colorPrimary: '#E01E00'
})

export default NeteaseYoudaoIcon
