import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { CohereAvatar } from './avatar'
import { CohereDark } from './dark'
import { CohereLight } from './light'

const Cohere = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <CohereLight className={cn('dark:hidden', className)} {...props} />
    <CohereDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const CohereIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cohere, {
  Light: CohereLight,
  Dark: CohereDark,
  Avatar: CohereAvatar,
  colorPrimary: '#39594D'
})

export default CohereIcon
