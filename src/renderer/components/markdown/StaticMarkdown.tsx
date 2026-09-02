import '@cherrystudio/ui/components/composites/markdown/styles'

import { Markdown, withFullMarkdown } from '@cherrystudio/ui'
import { remarkLatexMath } from '@renderer/components/chat/messages/markdown/plugins/remarkLatexMath'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { type FC, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Components } from 'streamdown'

import { useMarkdownComponents } from './MarkdownRenderers'
import { useMarkdownHost } from './useMarkdownHost'

interface Props {
  children: string
  /** Stable id (heading-id prefix + block memo key). Defaults to a generated id. */
  id?: string
  className?: string
  components?: Partial<Components>
}

/**
 * Non-streaming markdown for off-chat surfaces — release notes, the update dialog,
 * prompt preview, agent tool output. Renders through `@cherrystudio/ui`'s `<Markdown>`
 * with the full plugin preset and the app sanitize schema, replacing bare `<Streamdown>`
 * call sites so every preview shares one pipeline.
 *
 * It injects the application renderer set for code, tables, links, media and SVG.
 * Host-specific actions stay optional, so an embedded file preview can supply a
 * local-file opener without coupling this shared renderer to that feature.
 */
export const StaticMarkdown: FC<Props> = ({ children, id, className, components }) => {
  const { t } = useTranslation()
  const generatedId = useId()
  const blockId = id ?? generatedId
  const { openFilePath } = useMarkdownHost()

  const plugins = useMemo(() => withFullMarkdown({ singleDollarMath: true }), [])
  const content = useMemo(() => removeSvgEmptyLines(children), [children])
  const hasStyleElement = /<style\b[^>]*>/i.test(content)
  const markdownComponents = useMarkdownComponents({ components, hasStyleElement })

  return (
    <Markdown
      id={blockId}
      plugins={plugins}
      remarkPlugins={[remarkLatexMath]}
      components={markdownComponents}
      className={['static-markdown', className].filter(Boolean).join(' ')}
      footnoteLabel={t('common.footnotes')}
      preserveFileLinkHrefs={Boolean(openFilePath)}>
      {content}
    </Markdown>
  )
}
