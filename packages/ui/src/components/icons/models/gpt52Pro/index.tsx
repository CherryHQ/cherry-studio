import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { Gpt52ProAvatar } from './avatar'
import { Gpt52ProDark } from './dark'
import { Gpt52ProLight } from './light'

const Gpt52Pro = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <Gpt52ProLight className={cn('dark:hidden', className)} {...props} />
    <Gpt52ProDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const Gpt52ProIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt52Pro, {
  Light: Gpt52ProLight,
  Dark: Gpt52ProDark,
  Avatar: Gpt52ProAvatar,
  colorPrimary: '#000000'
})

export default Gpt52ProIcon
