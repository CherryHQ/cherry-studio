import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CohereAvatar } from './avatar'
import { CohereDark } from './dark'
import { CohereLight } from './light'

const Cohere = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CohereLight {...props} className={className} />
  if (variant === 'dark') return <CohereDark {...props} className={className} />
  return (
    <>
      <CohereLight className={cn('dark:hidden', className)} {...props} />
      <CohereDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const CohereIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cohere, {
  Avatar: CohereAvatar,
  colorPrimary: '#39594D'
})

export default CohereIcon
