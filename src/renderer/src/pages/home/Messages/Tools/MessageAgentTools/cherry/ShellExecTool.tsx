/**
 * Cherry-shape renderer for `shell__exec`.
 *
 * Mirrors `BashTool` but typed against cherry's discriminated-union
 * output (`completed` / `timeout` / `error`) instead of Claude Agent
 * SDK's freeform string. Surfaces exit code, duration, and (on timeout)
 * the configured budget — useful debugging signal that the existing
 * BashTool's stringly output drops.
 */
// TODO: shared types for all tools
import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { truncateOutput } from '../../shared/truncateOutput'
import { SkeletonValue, ToolHeader, TruncatedIndicator } from '../GenericTools'
import { TerminalOutput } from '../TerminalOutput'
import type { ShellExecInput, ShellExecOutput } from './types'

const KEY = 'shell__exec'

export function ShellExecTool({
  input,
  output
}: {
  input?: ShellExecInput
  output?: ShellExecOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const command = input?.command

  let stats: string | undefined
  let combinedText: string | undefined
  let isTruncatedOutput = false
  let originalLen = 0
  let footer: React.ReactNode = null

  if (output) {
    if (output.kind === 'completed') {
      stats = `exit ${output.exitCode} · ${output.durationMs}ms${output.truncated ? ' · truncated' : ''}`
      const merged = [output.stdout, output.stderr ? `\n[stderr]\n${output.stderr}` : ''].join('')
      const trunc = truncateOutput(merged)
      combinedText = trunc.data ?? undefined
      isTruncatedOutput = trunc.isTruncated
      originalLen = trunc.originalLength
    } else if (output.kind === 'timeout') {
      stats = `timeout · ${output.timeoutMs}ms`
      const merged = [output.stdout, output.stderr ? `\n[stderr]\n${output.stderr}` : ''].join('')
      const trunc = truncateOutput(merged)
      combinedText = trunc.data ?? undefined
      isTruncatedOutput = trunc.isTruncated
      originalLen = trunc.originalLength
      footer = <div className="mt-1 text-destructive text-xs">{t('message.tools.shell_exec.timeout', 'Timed out')}</div>
    } else {
      // error
      stats = output.code
      footer = (
        <div className="mt-1 text-destructive text-xs">
          [{output.code}] {output.message}
        </div>
      )
    }
  }

  return {
    key: KEY,
    label: (
      <ToolHeader
        toolName="shell__exec"
        params={<SkeletonValue value={command} width="180px" />}
        stats={stats}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div className="flex flex-col gap-3">
        {command && (
          <div>
            <div className="mb-1 font-medium text-muted-foreground text-xs">{t('message.tools.sections.command')}</div>
            <TerminalOutput content={command} commandMode maxHeight="10rem" />
          </div>
        )}

        {combinedText !== undefined ? (
          <div>
            <div className="mb-1 font-medium text-muted-foreground text-xs">{t('message.tools.sections.output')}</div>
            <TerminalOutput content={combinedText} maxHeight="15rem" />
            {isTruncatedOutput && <TruncatedIndicator originalLength={originalLen} />}
          </div>
        ) : (
          <SkeletonValue value={null} width="100%" fallback={null} />
        )}

        {footer}
      </div>
    )
  }
}
