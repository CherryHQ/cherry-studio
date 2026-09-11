import type { ReactNode } from 'react'

import { type WindowFrame, WindowFrameContext } from '@renderer/hooks/useWindowFrame'

export function WindowFrameProvider({ value, children }: { value: WindowFrame; children: ReactNode }) {
  return <WindowFrameContext value={value}>{children}</WindowFrameContext>
}
