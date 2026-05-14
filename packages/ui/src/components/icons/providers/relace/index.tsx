import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { RelaceAvatar } from './avatar'
import { RelaceDark } from './dark'
import { RelaceLight } from './light'

const Relace = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <RelaceLight className={cn('dark:hidden', className)} {...props} />
    <RelaceDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const RelaceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Relace, {
  Light: RelaceLight,
  Dark: RelaceDark,
  Avatar: RelaceAvatar,
  colorPrimary: '#000000'
})

export default RelaceIcon
