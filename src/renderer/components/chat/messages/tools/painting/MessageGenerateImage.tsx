import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import Spinner from '@renderer/components/Spinner'
import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { generateImageOutputSchema } from '@shared/ai/builtinTools'
import { toSafeFileUrl } from '@shared/utils/file'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ImageBlock from '../../blocks/ImageBlock'

/**
 * Resolve `generate_image` output FileEntry ids to renderable `file://` URLs.
 * The tool returns only `{ id, name }`; the on-disk path comes from a separate
 * `getPhysicalPath` IPC (same round-trip the Paintings page uses). Keyed on the
 * joined id string so the effect doesn't re-fire on every render (safeParse
 * hands back a fresh array each time).
 *
 * `failed` distinguishes "still resolving" (urls empty, not failed) from
 * "resolution failed" (urls empty, failed) — e.g. a historical message whose
 * file was since deleted — so the caller can show an error instead of a spinner
 * that never resolves.
 */
function useGeneratedImageUrls(ids: string[]): { urls: string[]; failed: boolean } {
  const key = ids.join(',')
  const [state, setState] = useState<{ urls: string[]; failed: boolean }>({ urls: [], failed: false })
  useEffect(() => {
    const list = key ? key.split(',') : []
    if (list.length === 0) {
      setState((current) => (current.urls.length === 0 && !current.failed ? current : { urls: [], failed: false }))
      return
    }
    let cancelled = false
    // Back to "resolving" for this id set (drops any stale failed flag from a previous set).
    setState({ urls: [], failed: false })
    // Resolve each id independently so one deleted/unreadable FileEntry drops only its own tile
    // instead of blanking the whole group; only flag `failed` when every id fails to resolve.
    // Per-item try/catch means the outer promise never rejects, so it is fire-and-forget (`void`).
    void Promise.all(
      list.map(async (id) => {
        try {
          return toSafeFileUrl(await window.api.file.getPhysicalPath({ id }), null)
        } catch {
          return null
        }
      })
    ).then((resolved) => {
      if (cancelled) return
      const urls = resolved.filter((url): url is NonNullable<typeof url> => url !== null)
      setState({ urls, failed: urls.length === 0 })
    })
    return () => {
      cancelled = true
    }
  }, [key])
  return state
}

const NoteText = ({ children }: { children: React.ReactNode }) => (
  <span className="flex min-w-0 items-center py-0.5 text-[13px] text-foreground-secondary leading-5">{children}</span>
)

export const MessageGenerateImageToolTitle = ({
  toolResponse
}: {
  toolResponse: McpToolResponse | NormalToolResponse
}) => {
  const { t } = useTranslation()
  const { inlineUrls, items } = useMemo(() => {
    const outputParse = generateImageOutputSchema.safeParse(toolResponse.response)
    const mcpOutputParse = CallToolResultSchema.safeParse(toolResponse.response)
    return {
      items: outputParse.success ? outputParse.data : [],
      inlineUrls: mcpOutputParse.success
        ? mcpOutputParse.data.content.flatMap((item) =>
            item.type === 'image' && item.data ? [`data:${item.mimeType ?? 'image/png'};base64,${item.data}`] : []
          )
        : []
    }
  }, [toolResponse.response])
  const { urls: resolvedUrls, failed: resolveFailed } = useGeneratedImageUrls(items.map((item) => item.id))
  const urls = inlineUrls.length > 0 ? inlineUrls : resolvedUrls

  // Still running (pending / streaming / invoking).
  if (toolResponse.status !== 'done' && toolResponse.status !== 'error') {
    return <Spinner text={<NoteText>{t('chat.input.tools.generate_image.generating')}</NoteText>} />
  }

  // Failure: a returned `{ error }` note, a thrown error, or files we could no longer resolve to a
  // path (`resolveFailed`) — otherwise the success branch below would spin forever. The main-side
  // `{ error }` / MCP text are English, model-facing notes; show localized UI copy instead of piping
  // them straight to the user (i18n: all user-visible strings go through i18next).
  if (urls.length === 0 && (items.length === 0 || resolveFailed)) {
    return <NoteText>{t('chat.input.tools.generate_image.failed')}</NoteText>
  }

  // No card chrome — just a caption and the image(s) laid out like any other image group
  // (single = bare, multiple = flex-wrap grid; mirrors MessagePartsRenderer).
  const isSingle = Math.max(items.length, urls.length) === 1
  return (
    <div className="group/tool my-px flex flex-col gap-1 first:mt-0 first:pt-0">
      <NoteText>{t('chat.input.tools.generate_image.title')}</NoteText>
      {isSingle ? (
        <ImageBlock images={urls} isPending={urls.length === 0} isSingle />
      ) : (
        <div className="flex flex-wrap gap-2.5">
          {urls.length === 0
            ? items.map((item) => <ImageBlock key={item.id} images={[]} isPending isSingle={false} />)
            : urls.map((src, index) => <ImageBlock key={index} images={[src]} isSingle={false} />)}
        </div>
      )}
    </div>
  )
}
