import type { ReactNode } from 'react'
import { Fragment } from 'react'

import { selectActiveComposerOverride, useComposerContext } from './ComposerContext'

type ComposerCoreProps = {
  fallback: ReactNode
  className?: string
}

export default function ComposerCore({ fallback, className }: ComposerCoreProps) {
  const composer = useComposerContext()
  const activeOverride = selectActiveComposerOverride(composer?.overrides)

  if (activeOverride) {
    return <Fragment key={activeOverride.id}>{activeOverride.render({ className })}</Fragment>
  }

  return <Fragment>{fallback}</Fragment>
}
