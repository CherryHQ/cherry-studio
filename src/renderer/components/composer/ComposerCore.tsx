import type { ReactNode } from 'react'
import { Fragment } from 'react'

import { selectActiveComposerOverride, useComposerContext } from './ComposerContext'

type ComposerCoreProps = {
  fallback: ReactNode
  className?: string
  forceNarrowLayout?: boolean
}

export default function ComposerCore({ fallback, className, forceNarrowLayout }: ComposerCoreProps) {
  const composer = useComposerContext()
  const activeOverride = selectActiveComposerOverride(composer?.overrides)

  if (activeOverride) {
    return <Fragment key={activeOverride.id}>{activeOverride.render({ className, forceNarrowLayout })}</Fragment>
  }

  return <Fragment>{fallback}</Fragment>
}
