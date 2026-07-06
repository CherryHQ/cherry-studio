import { Tooltip } from '@cherrystudio/ui'
import { Icon } from '@iconify/react'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import { getEditorIcon } from '@renderer/components/icons/EditorIcon'
import { FinderIcon } from '@renderer/components/icons/SvgIcon'
import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { getFileIconName } from '@renderer/utils/fileIconName'
import { normalizeInlineFilePath, resolveInlineFilePath } from '@renderer/utils/filePath'
import { isMac, isWin } from '@renderer/utils/platform'
import { REPORT_ARTIFACTS_TOOL_NAME, reportArtifactsInputSchema } from '@shared/ai/builtinTools'
import type { ExternalAppInfo } from '@shared/types/externalApp'
import type { TFunction } from 'i18next'
import { ExternalLink, FolderOpen } from 'lucide-react'
import { type MouseEvent, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useOptionalMessageListActions, useOptionalMessageListUi } from '../../MessageListProvider'

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

function getFileManagerName(t: TFunction): string {
  if (isMac) return t('agent.session.file_manager.finder')
  if (isWin) return t('agent.session.file_manager.file_explorer')
  return t('agent.session.file_manager.files')
}

function ReportArtifactFileCard({ artifact }: { artifact: ReportArtifactView }) {
  const { t } = useTranslation()
  const ui = useOptionalMessageListUi()
  const actions = useOptionalMessageListActions()
  const openArtifactFile = actions?.openArtifactFile
  const openPath = actions?.openPath
  const showInFolder = actions?.showInFolder
  const openInExternalApp = actions?.openInExternalApp
  const copyText = actions?.copyText
  const notifyError = actions?.notifyError
  const availableEditors = useMemo(() => ui?.externalCodeEditors ?? [], [ui?.externalCodeEditors])
  const displayPath = useMemo(() => normalizeInlineFilePath(artifact.path), [artifact.path])
  const targetPath = useMemo(() => resolveInlineFilePath(artifact.path), [artifact.path])
  const fileName = useMemo(() => getArtifactFileName(displayPath), [displayPath])
  const iconName = useMemo(() => getFileIconName(displayPath), [displayPath])
  const fileManagerName = useMemo(() => getFileManagerName(t), [t])

  const handlePreview = useCallback(() => {
    if (!openArtifactFile) return
    Promise.resolve(openArtifactFile(targetPath)).catch(() => {
      notifyError?.(t('chat.input.tools.open_file_error', { path: targetPath }))
    })
  }, [notifyError, openArtifactFile, t, targetPath])

  const handleOpenExternal = useCallback(() => {
    if (!openPath) return
    Promise.resolve(openPath(targetPath)).catch(() => {
      notifyError?.(t('chat.input.tools.open_file_error', { path: targetPath }))
    })
  }, [notifyError, openPath, t, targetPath])

  const handleReveal = useCallback(() => {
    if (!showInFolder) return
    Promise.resolve(showInFolder(targetPath)).catch(() => {
      notifyError?.(t('chat.input.tools.file_not_found', { path: targetPath }))
    })
  }, [notifyError, showInFolder, t, targetPath])

  const handleCopyPath = useCallback(() => {
    if (!copyText) return
    Promise.resolve(copyText(displayPath, { successMessage: t('common.copied') })).catch(() => {
      notifyError?.(t('message.copy.failed'))
    })
  }, [copyText, displayPath, notifyError, t])

  const handleOpenInEditor = useCallback(
    (app: ExternalAppInfo) => {
      if (!openInExternalApp) return
      Promise.resolve(openInExternalApp(app, targetPath)).catch(() => {
        notifyError?.(t('chat.input.tools.open_file_error', { path: targetPath }))
      })
    },
    [notifyError, openInExternalApp, t, targetPath]
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
    if (openPath) {
      items.push({
        type: 'item',
        id: 'artifact.open',
        label: t('chat.input.tools.open_file'),
        onSelect: handleOpenExternal
      })
    }
    if (showInFolder) {
      items.push({
        type: 'item',
        id: 'artifact.reveal',
        label: fileManagerName,
        icon: <span aria-hidden="true">{isMac ? <FinderIcon className="size-4" /> : <FolderOpen size={16} />}</span>,
        onSelect: handleReveal
      })
    }
    if (openInExternalApp) {
      for (const app of availableEditors) {
        items.push({
          type: 'item',
          id: `artifact.open-editor.${app.id}`,
          label: app.name,
          icon: getEditorIcon(app),
          onSelect: () => handleOpenInEditor(app)
        })
      }
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
    availableEditors,
    copyText,
    fileManagerName,
    handleCopyPath,
    handleOpenExternal,
    handleOpenInEditor,
    handlePreview,
    handleReveal,
    openArtifactFile,
    openInExternalApp,
    openPath,
    showInFolder,
    t
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
      {openPath && (
        <Tooltip content={t('chat.input.tools.open_file')} delay={500}>
          <button
            type="button"
            aria-label={`${t('chat.input.tools.open_file')} ${fileName}`}
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation()
              handleOpenExternal()
            }}
            className="mr-2 flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted opacity-70 transition-colors hover:bg-background hover:text-foreground hover:opacity-100">
            <ExternalLink size={15} />
          </button>
        </Tooltip>
      )}
    </div>
  )

  if (contextMenuItems.length === 0) {
    return card
  }

  return (
    <CommandContextMenu location="webcontents.context" extraItems={contextMenuItems}>
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
