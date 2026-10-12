import Ansi from 'ansi-to-react'
import type { ComponentPropsWithoutRef } from 'react'
import { memo, useMemo } from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'
import { useTheme } from '@renderer/hooks/useTheme'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'

import {
  colorizeShellOutput,
  shellColorPalettes,
  TERMINAL_LINK_CLASS,
  TERMINAL_SURFACE_CLASS
} from '../shared/terminalOutputHelpers'
import { toOutputText } from '../shared/truncateOutput'

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
  // Persisted parts can carry non-string content (JSON.parse'd bash output, corrupt command
  // input); normalize at the single rendering exit so no stored shape crashes the page (#20265).
  const text = toOutputText(content)
  const colorized = useMemo(() => colorizeShellOutput(text, commandMode, palette), [text, commandMode, palette])

  return (
    <TerminalContainer style={{ maxHeight }}>
      <Ansi>{colorized}</Ansi>
    </TerminalContainer>
  )
})

export const TerminalContainer = ({ className, style, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      "m-0 overflow-y-auto rounded-md px-2.5 py-2 font-['Menlo','Monaco','Courier_New',monospace] text-xs leading-normal break-all whitespace-pre-wrap [&_a]:underline [&_a]:decoration-dotted [&_a]:underline-offset-2 **:[[role=link]]:underline **:[[role=link]]:decoration-dotted **:[[role=link]]:underline-offset-2",
      TERMINAL_SURFACE_CLASS,
      TERMINAL_LINK_CLASS,
      className
    )}
    style={{ maxHeight: '15rem', ...style }}
    {...props}
  />
)
