import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Components, PluginConfig } from 'streamdown'
import type { Pluggable } from 'unified'

import { defaultMarkdownPlugins, Markdown, withMath } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { remarkLiteralAutolinkFix } from '@renderer/components/chat/messages/markdown/plugins/remarkLiteralAutolinkFix'
import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import { ipcApi } from '@renderer/ipc'
import { remarkLatexMath } from '@renderer/utils/remarkLatexMath'
import type { DocumentPrintPayload } from '@shared/ipc/schemas/print'

import { remarkPrintImages, trackPrintHighlighting, waitForPrintReady } from './documentPrintMarkdown'

const logger = loggerService.withContext('DocumentPrint')
const DISALLOWED_ELEMENTS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
  'video',
  'audio'
]

function DocumentPrintContent({ payload }: { payload: DocumentPrintPayload }) {
  const { t } = useTranslation()
  const [singleDollarMath] = usePreference('chat.message.math.single_dollar')
  const rootRef = useRef<HTMLElement>(null)
  const highlighting = useMemo(() => {
    if (!defaultMarkdownPlugins.code) throw new Error('Document code highlighter is unavailable')
    return trackPrintHighlighting(defaultMarkdownPlugins.code)
  }, [])
  const plugins: PluginConfig = useMemo(
    () => ({
      ...defaultMarkdownPlugins,
      code: highlighting.code,
      math: withMath({ singleDollar: singleDollarMath })
    }),
    [highlighting, singleDollarMath]
  )
  const remarkPlugins: Pluggable[] = useMemo(
    () => [remarkLiteralAutolinkFix, remarkLatexMath, [remarkPrintImages, { images: payload.images }]],
    [payload.images]
  )
  const components = useMemo<Partial<Components>>(() => {
    const verifiedImages = new Set(Object.values(payload.images))
    return {
      img: ({ src, alt, title }) => {
        if (typeof src !== 'string' || !verifiedImages.has(src))
          throw new Error('Document contains an unverified image')
        return <img src={src} alt={alt ?? ''} title={title} loading="eager" />
      },
      table: ({ children }) => <table>{children}</table>,
      a: ({ href, children }) => <a href={href}>{children}</a>
    }
  }, [payload.images])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    document.title = payload.title
    const abort = new AbortController()
    void waitForPrintReady(root, () => highlighting.isReady(root), abort.signal)
      .then(() => ipcApi.request('print.document.ready', {}))
      .catch((error) => {
        if (abort.signal.aborted) return
        logger.error('Document print preparation failed', error as Error)
        void ipcApi
          .request('print.document.ready', {
            error: error instanceof Error ? error.message : String(error)
          })
          .catch((reportError) => logger.error('Failed to report print preparation failure', reportError as Error))
      })
    return () => abort.abort()
  }, [highlighting, payload.title])

  return (
    <article ref={rootRef}>
      <Markdown
        id="document-print"
        plugins={plugins}
        remarkPlugins={remarkPlugins}
        components={components}
        disallowedElements={DISALLOWED_ELEMENTS}
        footnoteLabel={t('common.footnotes')}>
        {payload.markdown}
      </Markdown>
    </article>
  )
}

export default function DocumentPrintApp() {
  const payload = useWindowInitData<DocumentPrintPayload>()
  return payload ? <DocumentPrintContent payload={payload} /> : null
}
