import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { RecraftAvatar } from './avatar'
import { RecraftDark } from './dark'
import { RecraftLight } from './light'

const Recraft = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <RecraftLight className={cn('dark:hidden', className)} {...props} />
    <RecraftDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const RecraftIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Recraft, {
  Light: RecraftLight,
  Dark: RecraftDark,
  Avatar: RecraftAvatar,
  colorPrimary: '#010101'
})

export default RecraftIcon
