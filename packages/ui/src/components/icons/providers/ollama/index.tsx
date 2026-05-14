import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { OllamaAvatar } from './avatar'
import { OllamaDark } from './dark'
import { OllamaLight } from './light'

const Ollama = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <OllamaLight className={cn('dark:hidden', className)} {...props} />
    <OllamaDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const OllamaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ollama, {
  Light: OllamaLight,
  Dark: OllamaDark,
  Avatar: OllamaAvatar,
  colorPrimary: '#000000'
})

export default OllamaIcon
