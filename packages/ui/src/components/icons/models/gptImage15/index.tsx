import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptImage15Avatar } from './avatar'
import { GptImage15Dark } from './dark'
import { GptImage15Light } from './light'

const GptImage15 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptImage15Light {...props} className={className} />
  if (variant === 'dark') return <GptImage15Dark {...props} className={className} />
  return (
    <>
      <GptImage15Light className={cn('dark:hidden', className)} {...props} />
      <GptImage15Dark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GptImage15Icon: CompoundIcon = /*#__PURE__*/ Object.assign(GptImage15, {
  Avatar: GptImage15Avatar,
  colorPrimary: '#000000'
})

export default GptImage15Icon
