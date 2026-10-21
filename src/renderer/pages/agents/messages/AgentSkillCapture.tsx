import { useNavigate } from '@tanstack/react-router'
import { Check, Loader2, ToolCase } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import type { SkillCapturePresentation } from '@renderer/components/chat/messages/tools/agent'
import { FilePreview } from '@renderer/components/FilePreview'
import { useDataChange, useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { useAgentSessionBackgroundTasks } from '@renderer/hooks/agent/useAgentSessionBackgroundTasks'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { formatErrorMessage } from '@renderer/utils/error'
import { normalizeFilePreviewPath } from '@renderer/utils/filePreview'
import type { AbsoluteFilePath } from '@shared/types/file'
import type { SkillDraftReview } from '@shared/types/skillCapture'

export function AgentSkillCapture({ result }: { result: SkillCapturePresentation }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const ref = { sessionId: result.sessionId, messageId: result.messageId }
  const { data: message, refetch } = useQuery('/agent-sessions/:sessionId/messages/:messageId', { params: ref })
  const capture = message?.data.skillCapture
  const { data: generated, refetch: refetchGenerated } = useQuery('/agent-sessions/:sessionId/messages/:messageId', {
    params: { sessionId: result.sessionId, messageId: capture?.generationMessageId ?? '' },
    enabled: !!capture?.generationMessageId
  })
  useDataChange(
    '/agent-sessions/:sessionId/messages',
    () => {
      void refetch()
      if (capture?.generationMessageId) void refetchGenerated()
    },
    { routeParams: { sessionId: result.sessionId } }
  )
  const { trigger: dismiss } = useMutation('DELETE', '/agent-sessions/:sessionId/messages/:messageId/skill-suggestion')
  const stream = useTopicStreamStatus(buildAgentSessionTopicId(result.sessionId))
  const background = useAgentSessionBackgroundTasks(result.sessionId)
  const [pending, setPending] = useState(false)
  const [review, setReview] = useState<SkillDraftReview | null>(null)
  const [previewFile, setPreviewFile] = useState<AbsoluteFilePath | null>(null)
  const busy = stream.isPending || stream.awaitingApprovalAnchors.length > 0 || background.length > 0

  useEffect(() => {
    setReview(null)
    setPreviewFile(null)
  }, [capture?.revision])

  if (!capture || message?.status !== 'success' || capture.status === 'dismissed' || capture.status === 'discarded')
    return null
  if (result.revision ? result.revision !== capture.revision : ['ready', 'saved'].includes(capture.status)) return null
  if (result.generationMessageId && result.generationMessageId !== capture.generationMessageId) return null
  if (capture.status === 'suggested' && busy) return null

  const run = async (action: () => Promise<unknown>) => {
    setPending(true)
    try {
      await action()
      await refetch()
    } catch (error) {
      toast.error(formatErrorMessage(error))
    } finally {
      setPending(false)
    }
  }
  const start = () =>
    run(() =>
      ipcApi.request('skill.capture.start', {
        ...ref,
        requestText: t('skill_capture.request', { name: capture.name })
      })
    )
  const failed = !!generated && generated.status !== 'success' && !busy
  const disabled = pending || busy

  return (
    <div className="my-2 flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {capture.status === 'saved' ? (
          <Check size={16} aria-hidden="true" />
        ) : pending || busy ? (
          <Loader2 size={16} aria-hidden="true" className="animate-spin" />
        ) : (
          <ToolCase size={16} aria-hidden="true" />
        )}
        <span>{review?.name ?? capture.name}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        {capture.status === 'saved'
          ? t('skill_capture.saved')
          : capture.status === 'suggested'
            ? capture.reason
            : (review?.description ?? capture.description)}
      </p>
      {capture.status === 'generating' && (
        <p className="text-xs text-muted-foreground">
          {t(busy ? 'skill_capture.generating' : 'skill_capture.interrupted')}
        </p>
      )}
      {capture.status === 'ready' && (
        <p className="text-xs text-muted-foreground">
          {t(failed ? 'skill_capture.interrupted' : 'skill_capture.edit_hint')}
        </p>
      )}
      {review && (
        <ul className="flex flex-col gap-1">
          {review.files.map((file) => (
            <li key={file.name}>
              <Button variant="link" size="sm" onClick={() => setPreviewFile(normalizeFilePreviewPath(file.path))}>
                {file.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {previewFile && capture.status === 'ready' && (
        <div className="h-80 min-h-0 overflow-hidden rounded-md border border-border">
          <FilePreview filePath={previewFile} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {capture.status === 'suggested' && (
          <>
            <Button size="sm" disabled={disabled} onClick={() => void start()}>
              {t('skill_capture.suggest')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => void run(() => dismiss({ params: ref }))}>
              {t('skill_capture.dismiss')}
            </Button>
          </>
        )}
        {(capture.status === 'generating' || (capture.status === 'ready' && failed)) && !busy && (
          <Button size="sm" disabled={disabled} onClick={() => void start()}>
            {t('skill_capture.retry')}
          </Button>
        )}
        {capture.status === 'ready' && !failed && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  const next = await ipcApi.request('skill.capture.review', ref)
                  setReview(next)
                  const file = next.files.find((item) => item.name === 'SKILL.md') ?? next.files[0]
                  setPreviewFile(file ? normalizeFilePreviewPath(file.path) : null)
                })
              }>
              {t('skill_capture.preview')}
            </Button>
            <Button
              size="sm"
              disabled={disabled || !review}
              onClick={() =>
                void run(() =>
                  ipcApi.request('skill.capture.save', {
                    ...ref,
                    revision: review!.revision
                  })
                )
              }>
              {t('skill_capture.save')}
            </Button>
          </>
        )}
        {['generating', 'ready'].includes(capture.status) && (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => void run(() => ipcApi.request('skill.capture.discard', ref))}>
            {t('skill_capture.discard')}
          </Button>
        )}
        {capture.status === 'saved' && capture.skillId && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void navigate({ to: '/settings/skills/$skillId', params: { skillId: capture.skillId! } })}>
            {t('skill_capture.open')}
          </Button>
        )}
      </div>
    </div>
  )
}
