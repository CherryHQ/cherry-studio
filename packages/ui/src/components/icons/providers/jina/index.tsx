import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { JinaAvatar } from './avatar'
import { JinaDark } from './dark'
import { JinaLight } from './light'

const Jina = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <JinaLight {...props} className={className} />
  if (variant === 'dark') return <JinaDark {...props} className={className} />
  return (
    <>
      <JinaLight className={cn('dark:hidden', className)} {...props} />
      <JinaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const JinaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Jina, {
  Avatar: JinaAvatar,
  colorPrimary: '#EB6161'
})

export default JinaIcon
