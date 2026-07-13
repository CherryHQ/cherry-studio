import Spinner from '@renderer/components/Spinner'
import type { NormalToolResponse } from '@renderer/types/mcpTool'
import { generateImageOutputSchema } from '@shared/ai/builtinTools'
import { toSafeFileUrl } from '@shared/utils/file'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ImageBlock from '../../blocks/ImageBlock'
import { ToolDisclosure } from '../shared/ToolDisclosure'

/**
 * Resolve `generate_image` output FileEntry ids to renderable `file://` URLs.
 * The tool returns only `{ id, name }`; the on-disk path comes from a separate
 * `getPhysicalPath` IPC (same round-trip the Paintings page uses). Keyed on the
 * joined id string so the effect doesn't re-fire on every render (safeParse
 * hands back a fresh array each time).
 */
function useGeneratedImageUrls(ids: string[]): string[] {
  const key = ids.join(',')
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    const list = key ? key.split(',') : []
    if (list.length === 0) {
      setUrls([])
      return
    }
    let cancelled = false
    Promise.all(list.map(async (id) => toSafeFileUrl(await window.api.file.getPhysicalPath({ id }), null)))
      .then((resolved) => !cancelled && setUrls(resolved))
      .catch(() => !cancelled && setUrls([]))
    return () => {
      cancelled = true
    }
  }, [key])
  return urls
}

const NoteText = ({ children }: { children: React.ReactNode }) => (
  <span className="flex min-w-0 items-center py-0.5 text-[13px] text-foreground-secondary leading-5">{children}</span>
)

export const MessageGenerateImageToolTitle = ({ toolResponse }: { toolResponse: NormalToolResponse }) => {
  const { t } = useTranslation()
  const outputParse = generateImageOutputSchema.safeParse(toolResponse.response)
  const items = outputParse.success ? outputParse.data : []
  const urls = useGeneratedImageUrls(items.map((item) => item.id))

  // Still running (pending / streaming / invoking).
  if (toolResponse.status !== 'done' && toolResponse.status !== 'error') {
    return <Spinner text={<NoteText>{t('chat.tools.generate_image.generating')}</NoteText>} />
  }

  // Failure: a returned `{ error }` note, or a thrown error (generic fallback).
  if (!outputParse.success || items.length === 0) {
    const response = toolResponse.response
    const errorText =
      response && typeof response === 'object' && typeof (response as { error?: unknown }).error === 'string'
        ? (response as { error: string }).error
        : t('chat.tools.generate_image.failed')
    return <NoteText>{errorText}</NoteText>
  }

  return (
    <div className="group/tool my-px first:mt-0 first:pt-0">
      <ToolDisclosure
        variant="light"
        className="message-tools-container border-none"
        defaultActiveKey={[toolResponse.id]}
        items={[
          {
            key: toolResponse.id,
            label: <NoteText>{t('chat.tools.generate_image.title')}</NoteText>,
            children: <ImageBlock images={urls} isPending={urls.length === 0} isSingle={items.length === 1} />
          }
        ]}
      />
    </div>
  )
}
