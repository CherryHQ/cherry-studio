import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { FeloAvatar } from './avatar'
import { FeloDark } from './dark'
import { FeloLight } from './light'

const Felo = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <FeloLight className={cn('dark:hidden', className)} {...props} />
    <FeloDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const FeloIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Felo, {
  Light: FeloLight,
  Dark: FeloDark,
  Avatar: FeloAvatar,
  colorPrimary: '#000000'
})

export default FeloIcon
