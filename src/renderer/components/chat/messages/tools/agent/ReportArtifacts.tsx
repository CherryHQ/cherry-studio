import { Tooltip } from '@cherrystudio/ui'
import { Icon } from '@iconify/react'
import type { McpToolResponse, NormalToolResponse } from '@renderer/types'
import { getFileIconName } from '@renderer/utils/fileIconName'
import { REPORT_ARTIFACTS_TOOL_NAME, reportArtifactsInputSchema } from '@shared/ai/builtinTools'
import { ExternalLink } from 'lucide-react'
import { type MouseEvent, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useOptionalMessageListActions } from '../../MessageListProvider'
import { normalizeInlineFilePath, resolveInlineFilePath } from '../../utils/filePath'

export type ReportArtifactsToolResponse = McpToolResponse | NormalToolResponse

interface ReportArtifactView {
  path: string
  description?: string
}

interface ReportArtifactsViewModel {
  artifacts: ReportArtifactView[]
  summary?: string
}

export function isReportArtifactsToolResponse(toolResponse: ReportArtifactsToolResponse): boolean {
  const toolName = toolResponse.tool.name
  return toolName === REPORT_ARTIFACTS_TOOL_NAME || toolName.endsWith(`__${REPORT_ARTIFACTS_TOOL_NAME}`)
}

export function getReportArtifactsViewModel(
  toolResponses: readonly ReportArtifactsToolResponse[]
): ReportArtifactsViewModel | null {
  const artifactByPath = new Map<string, ReportArtifactView>()
  let summary: string | undefined

  for (const toolResponse of toolResponses) {
    if (!isReportArtifactsToolResponse(toolResponse)) continue

    const parsed = reportArtifactsInputSchema.safeParse(toolResponse.arguments)
    if (!parsed.success) continue

    if (parsed.data.summary) summary = parsed.data.summary
    for (const artifact of parsed.data.artifacts) {
      const path = artifact.path.trim()
      if (!path) continue
      artifactByPath.set(path, {
        path,
        description: artifact.description
      })
    }
  }

  const artifacts = Array.from(artifactByPath.values())
  return artifacts.length > 0 ? { artifacts, summary } : null
}

function getArtifactFileName(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/g, '')
  const segments = normalized.split(/[\\/]+/).filter(Boolean)
  return segments.at(-1) ?? path
}

function ReportArtifactFileCard({ artifact }: { artifact: ReportArtifactView }) {
  const { t } = useTranslation()
  const actions = useOptionalMessageListActions()
  const openArtifactFile = actions?.openArtifactFile
  const openPath = actions?.openPath
  const notifyError = actions?.notifyError
  const displayPath = useMemo(() => normalizeInlineFilePath(artifact.path), [artifact.path])
  const targetPath = useMemo(() => resolveInlineFilePath(artifact.path), [artifact.path])
  const fileName = useMemo(() => getArtifactFileName(displayPath), [displayPath])
  const iconName = useMemo(() => getFileIconName(displayPath), [displayPath])

  const handlePreview = useCallback(() => {
    if (!openArtifactFile) return
    Promise.resolve(openArtifactFile(targetPath)).catch(() => {
      notifyError?.(t('chat.input.tools.open_file_error', { path: targetPath }))
    })
  }, [notifyError, openArtifactFile, t, targetPath])

  const handleOpenExternal = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      if (!openPath) return
      Promise.resolve(openPath(targetPath)).catch(() => {
        notifyError?.(t('chat.input.tools.open_file_error', { path: targetPath }))
      })
    },
    [notifyError, openPath, t, targetPath]
  )

  return (
    <div className="group/artifact flex w-full max-w-xl items-center overflow-hidden rounded-lg border-[0.5px] border-border bg-background-subtle transition-colors hover:bg-accent">
      <button
        type="button"
        disabled={!openArtifactFile}
        onClick={handlePreview}
        title={displayPath}
        aria-label={`${t('common.preview')} ${fileName}`}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent px-2.5 py-2 text-left disabled:cursor-default">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background">
          <Icon icon={`material-icon-theme:${iconName}`} className="text-[20px]" />
        </span>
        <span className="min-w-0 truncate font-medium text-[13px] text-foreground leading-5">{fileName}</span>
      </button>
      {openPath && (
        <Tooltip content={t('chat.input.tools.open_file')} delay={500}>
          <button
            type="button"
            aria-label={`${t('chat.input.tools.open_file')} ${fileName}`}
            onClick={handleOpenExternal}
            className="mr-2 flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted opacity-70 transition-colors hover:bg-background hover:text-foreground hover:opacity-100">
            <ExternalLink size={15} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}

/**
 * Message-level footer for `report_artifacts` declarations. The tool call itself is hidden from the
 * inline tool stream; this card is appended after the complete message content so deliverables stay
 * visually anchored to the final answer instead of the tool-call position.
 */
export const MessageReportArtifacts = ({
  toolResponses
}: {
  toolResponses: readonly ReportArtifactsToolResponse[]
}) => {
  const viewModel = getReportArtifactsViewModel(toolResponses)
  if (!viewModel) return null

  return (
    <div className="my-1 flex w-full flex-col gap-1.5">
      {viewModel.artifacts.map((artifact) => (
        <ReportArtifactFileCard key={artifact.path} artifact={artifact} />
      ))}
    </div>
  )
}
