import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { DeepcogitoAvatar } from './avatar'
import { DeepcogitoDark } from './dark'
import { DeepcogitoLight } from './light'

const Deepcogito = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <DeepcogitoLight className={cn('dark:hidden', className)} {...props} />
    <DeepcogitoDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const DeepcogitoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Deepcogito, {
  Light: DeepcogitoLight,
  Dark: DeepcogitoDark,
  Avatar: DeepcogitoAvatar,
  colorPrimary: '#4E81EE'
})

export default DeepcogitoIcon
