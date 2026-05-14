import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { VoyageAvatar } from './avatar'
import { VoyageDark } from './dark'
import { VoyageLight } from './light'

const Voyage = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <VoyageLight className={cn('dark:hidden', className)} {...props} />
    <VoyageDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const VoyageIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Voyage, {
  Light: VoyageLight,
  Dark: VoyageDark,
  Avatar: VoyageAvatar,
  colorPrimary: '#012E33'
})

export default VoyageIcon
