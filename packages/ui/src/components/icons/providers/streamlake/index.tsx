import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { StreamlakeAvatar } from './avatar'
import { StreamlakeDark } from './dark'
import { StreamlakeLight } from './light'

const Streamlake = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <StreamlakeLight className={cn('dark:hidden', className)} {...props} />
    <StreamlakeDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const StreamlakeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Streamlake, {
  Light: StreamlakeLight,
  Dark: StreamlakeDark,
  Avatar: StreamlakeAvatar,
  colorPrimary: '#1D70FF'
})

export default StreamlakeIcon
