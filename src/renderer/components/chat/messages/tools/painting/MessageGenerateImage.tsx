import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import Spinner from '@renderer/components/Spinner'
import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { toSafeFileUrl } from '@shared/utils/file'

import ImageBlock from '../../blocks/ImageBlock'
import { ToolApprovalOutcome } from '../shared/ToolApprovalOutcome'
import { parseGeneratedImageOutput } from './generateImageTool'

type ImageResolution = { key: string; urls: (string | null)[] }

function useGeneratedImageUrls(ids: string[], attempt: number) {
  const key = ids.join(',')
  const [state, setState] = useState<ImageResolution>({ key: '', urls: [] })
  useEffect(() => {
    let cancelled = false
    const list = key ? key.split(',') : []
    setState({ key: '', urls: [] })
    void Promise.all(
      list.map(async (id) => {
        try {
          return toSafeFileUrl(await window.api.file.getPhysicalPath({ id }), null)
        } catch {
          return null
        }
      })
    ).then((urls) => {
      if (!cancelled) setState({ key, urls })
    })
    return () => {
      cancelled = true
    }
  }, [key, attempt])
  return state.key === key ? state.urls : []
}

const NoteText = ({ children }: { children: React.ReactNode }) => (
  <span className="flex min-w-0 items-center py-0.5 text-[13px] text-muted-foreground leading-5">{children}</span>
)

export const MessageGenerateImageToolTitle = ({
  toolResponse
}: {
  toolResponse: McpToolResponse | NormalToolResponse
}) => {
  const { t } = useTranslation()
  const { inlineItems, inlineUrls, items } = useMemo(
    () => parseGeneratedImageOutput(toolResponse.response),
    [toolResponse.response]
  )
  const allItems = useMemo(() => [...items, ...inlineItems], [inlineItems, items])
  const [attempt, setAttempt] = useState(0)
  const resolvedUrls = useGeneratedImageUrls(
    allItems.map((item) => item.id),
    attempt
  )

  const previewImages = [...resolvedUrls.filter((url): url is string => Boolean(url)), ...inlineUrls]

  if (toolResponse.approval?.approved === false) {
    return <ToolApprovalOutcome approval={toolResponse.approval} />
  }

  // Still running (pending / streaming / invoking).
  if (toolResponse.status !== 'done' && toolResponse.status !== 'error') {
    return <Spinner text={<NoteText>{t('chat.input.tools.generate_image.generating')}</NoteText>} />
  }

  if (allItems.length === 0 && inlineUrls.length === 0) {
    return <NoteText>{t('chat.input.tools.generate_image.failed')}</NoteText>
  }

  return (
    <div className="group/tool my-px flex flex-col gap-1 first:mt-0 first:pt-0">
      <NoteText>{t('chat.input.tools.generate_image.title')}</NoteText>
      {allItems.length > 0 ? (
        <div className="flex flex-wrap gap-2.5">
          {allItems.map((item, index) => {
            const url = resolvedUrls[index]
            return url === null ? (
              <div key={item.id} role="status" className="rounded-lg border border-border-subtle p-3 text-sm">
                <p>{item.name}</p>
                <p>{t('file_preview.unavailable.description')}</p>
                <Button variant="ghost" size="sm" onClick={() => setAttempt((value) => value + 1)}>
                  {t('common.retry')}
                </Button>
              </div>
            ) : (
              <ImageBlock
                key={item.id}
                images={url ? [url] : []}
                previewImages={previewImages}
                isPending={!url}
                isSingle={allItems.length === 1}
              />
            )
          })}
        </div>
      ) : (
        <ImageBlock images={inlineUrls} isSingle={inlineUrls.length === 1} />
      )}
    </div>
  )
}
