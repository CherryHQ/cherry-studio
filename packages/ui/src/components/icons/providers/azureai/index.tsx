import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { AzureaiAvatar } from './avatar'
import { AzureaiDark } from './dark'
import { AzureaiLight } from './light'

const Azureai = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <AzureaiLight className={cn('dark:hidden', className)} {...props} />
    <AzureaiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const AzureaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Azureai, {
  Light: AzureaiLight,
  Dark: AzureaiDark,
  Avatar: AzureaiAvatar,
  colorPrimary: '#000000'
})

export default AzureaiIcon
