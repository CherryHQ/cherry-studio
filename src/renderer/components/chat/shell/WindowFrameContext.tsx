import { type WindowFrame, WindowFrameContext } from '@renderer/hooks/useWindowFrame'
import type { ReactNode } from 'react'

export function WindowFrameProvider({ value, children }: { value: WindowFrame; children: ReactNode }) {
  return <WindowFrameContext value={value}>{children}</WindowFrameContext>
}
