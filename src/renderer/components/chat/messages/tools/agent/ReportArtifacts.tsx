import { Button } from '@cherrystudio/ui'
import { Icon } from '@iconify/react'
import { CommandContextMenu, type CommandContextMenuExtraItem, CommandPopupMenu } from '@renderer/components/command'
import { getOpenTargetBadge, getOpenTargetLabel, OpenTargetIcon } from '@renderer/components/OpenTarget'
import { useExternalOpenTargets } from '@renderer/hooks/useExternalOpenTargets'
import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { getFileIconName } from '@renderer/utils/fileIconName'
import { normalizeInlineFilePath, resolveInlineFilePath } from '@renderer/utils/filePath'
import { REPORT_ARTIFACTS_TOOL_NAME, reportArtifactsInputSchema } from '@shared/ai/builtinTools'
import type { ExternalOpenTarget } from '@shared/types/externalApp'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { ChevronDown } from 'lucide-react'
import { type MouseEvent, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useOptionalMessageListActions } from '../../MessageListProvider'

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
  const copyText = actions?.copyText
  const notifyError = actions?.notifyError
  const resolvePath = actions?.resolvePath
  const displayPath = useMemo(() => normalizeInlineFilePath(artifact.path), [artifact.path])
  const unresolvedTargetPath = useMemo(() => resolveInlineFilePath(artifact.path), [artifact.path])
  const targetPath = useMemo(
    () => resolvePath?.(unresolvedTargetPath) ?? unresolvedTargetPath,
    [resolvePath, unresolvedTargetPath]
  )
  const fileName = useMemo(() => getArtifactFileName(displayPath), [displayPath])
  const iconName = useMemo(() => getFileIconName(displayPath), [displayPath])
  const [popupMenuOpen, setPopupMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const hasAbsoluteTargetPath = AbsoluteFilePathSchema.safeParse(targetPath).success
  const { data, error, targets, openTarget } = useExternalOpenTargets(targetPath, 'file', {
    enabled: hasAbsoluteTargetPath && (popupMenuOpen || contextMenuOpen)
  })
  const hasOpenActions = Boolean(openArtifactFile || hasAbsoluteTargetPath)

  const handlePreview = useCallback(() => {
    if (!openArtifactFile) return
    Promise.resolve(openArtifactFile(targetPath)).catch(() => {
      notifyError?.(t('chat.input.tools.open_file_error', { path: targetPath }))
    })
  }, [notifyError, openArtifactFile, t, targetPath])

  const handleCopyPath = useCallback(() => {
    if (!copyText) return
    Promise.resolve(copyText(displayPath, { successMessage: t('common.copied') })).catch(() => {
      notifyError?.(t('message.copy.failed'))
    })
  }, [copyText, displayPath, notifyError, t])

  const handleOpenTarget = useCallback(
    (target: ExternalOpenTarget) => {
      void openTarget(target).catch(() => {
        notifyError?.(t('chat.input.tools.open_file_error', { path: targetPath }))
      })
    },
    [notifyError, openTarget, t, targetPath]
  )

  const contextMenuItems = useMemo<readonly CommandContextMenuExtraItem[]>(() => {
    const items: CommandContextMenuExtraItem[] = []
    if (openArtifactFile) {
      items.push({
        type: 'item',
        id: 'artifact.preview',
        label: t('common.preview'),
        onSelect: handlePreview
      })
    }
    if (hasAbsoluteTargetPath && targets.length === 0 && !data && !error) {
      items.push({
        type: 'item',
        id: 'artifact.open-target.loading',
        label: t('common.loading'),
        enabled: false,
        onSelect: () => undefined
      })
    }
    for (const target of targets) {
      items.push({
        type: 'item',
        id: `artifact.open-target.${target.id}`,
        label: getOpenTargetLabel(target, t),
        icon: <OpenTargetIcon target={target} />,
        badge: getOpenTargetBadge(target, t),
        onSelect: () => handleOpenTarget(target)
      })
    }
    if (copyText) {
      if (items.length > 0) items.push({ type: 'separator' })
      items.push({
        type: 'item',
        id: 'artifact.copy-path',
        label: t('common.copy'),
        onSelect: handleCopyPath
      })
    }
    return items
  }, [
    copyText,
    data,
    error,
    handleCopyPath,
    handleOpenTarget,
    handlePreview,
    hasAbsoluteTargetPath,
    openArtifactFile,
    t,
    targets
  ])

  const card = (
    <div className="group/artifact flex w-full max-w-xl items-center overflow-hidden rounded-lg border-[0.5px] border-border bg-background-subtle transition-colors hover:bg-accent">
      <button
        type="button"
        aria-disabled={!openArtifactFile}
        onClick={openArtifactFile ? handlePreview : undefined}
        title={displayPath}
        aria-label={`${t('common.preview')} ${fileName}`}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent px-2.5 py-2 text-left aria-disabled:cursor-default">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background">
          <Icon icon={`material-icon-theme:${iconName}`} className="text-[20px]" />
        </span>
        <span className="min-w-0 truncate font-medium text-[13px] text-foreground leading-5">{fileName}</span>
      </button>
      {hasOpenActions && (
        <CommandPopupMenu
          location="webcontents.context"
          extraItems={contextMenuItems}
          onOpenChange={setPopupMenuOpen}
          align="end"
          side="bottom"
          sideOffset={6}
          contentClassName="min-w-44">
          <Button
            type="button"
            variant="outline"
            aria-label={`${t('chat.input.tools.open_with')} ${fileName}`}
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation()
            }}
            className="mr-2 rounded-lg data-[state=open]:bg-accent">
            {t('chat.input.tools.open_with')}
            <ChevronDown className="text-muted-foreground" size={14} />
          </Button>
        </CommandPopupMenu>
      )}
    </div>
  )

  if (contextMenuItems.length === 0) {
    return card
  }

  return (
    <CommandContextMenu location="webcontents.context" extraItems={contextMenuItems} onOpenChange={setContextMenuOpen}>
      {card}
    </CommandContextMenu>
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
  // Memoised: `getReportArtifactsViewModel` zod-parses each response, and this
  // card re-renders on every streaming tick. `toolResponses` is already a stable
  // memoised ref from `MessagePartsRenderer`, so this skips re-parsing per tick.
  const viewModel = useMemo(() => getReportArtifactsViewModel(toolResponses), [toolResponses])
  if (!viewModel) return null

  return (
    <div className="my-1 flex w-full flex-col gap-1.5">
      {viewModel.artifacts.map((artifact) => (
        <ReportArtifactFileCard key={artifact.path} artifact={artifact} />
      ))}
    </div>
  )
}
