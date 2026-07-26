import { cn } from '@cherrystudio/ui/lib/utils'
import { useTheme } from '@renderer/hooks/useTheme'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import Ansi from 'ansi-to-react'
import type { ComponentPropsWithoutRef } from 'react'
import { memo, useMemo } from 'react'

import {
  colorizeShellOutput,
  shellColorPalettes,
  TERMINAL_LINK_CLASS,
  TERMINAL_SURFACE_CLASS
} from '../shared/terminalOutputHelpers'

interface TerminalOutputProps {
  content: string
  commandMode?: boolean
  maxHeight?: string
}

export const TerminalOutput = memo(function TerminalOutput({
  content,
  commandMode = false,
  maxHeight = '15rem'
}: TerminalOutputProps) {
  const { theme } = useTheme()
  const isDark = theme !== ThemeMode.light
  const palette = isDark ? shellColorPalettes.dark : shellColorPalettes.light
  const colorized = useMemo(() => colorizeShellOutput(content, commandMode, palette), [content, commandMode, palette])

  return (
    <TerminalContainer style={{ maxHeight }}>
      <Ansi>{colorized}</Ansi>
    </TerminalContainer>
  )
})

export const TerminalContainer = ({ className, style, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      "m-0 overflow-y-auto whitespace-pre-wrap break-all rounded-md px-2.5 py-2 font-['Menlo','Monaco','Courier_New',monospace] text-xs leading-normal [&_a]:underline [&_a]:decoration-dotted [&_a]:underline-offset-2 **:[[role=link]]:underline **:[[role=link]]:decoration-dotted **:[[role=link]]:underline-offset-2",
      TERMINAL_SURFACE_CLASS,
      TERMINAL_LINK_CLASS,
      className
    )}
    style={{ maxHeight: '15rem', ...style }}
    {...props}
  />
)
