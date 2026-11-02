import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CheaperInferenceAvatar } from './avatar'
import { CheaperInferenceDark } from './dark'
import { CheaperInferenceLight } from './light'

const CheaperInference = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CheaperInferenceLight {...props} className={className} />
  if (variant === 'dark') return <CheaperInferenceDark {...props} className={className} />
  return (
    <>
      <CheaperInferenceLight className={cn('dark:hidden', className)} {...props} />
      <CheaperInferenceDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const CheaperInferenceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(CheaperInference, {
  Avatar: CheaperInferenceAvatar,
  colorPrimary: '#000000'
})

export default CheaperInferenceIcon
