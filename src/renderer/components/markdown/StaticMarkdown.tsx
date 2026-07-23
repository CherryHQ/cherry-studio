import '@cherrystudio/ui/components/composites/markdown/styles'

import { Markdown, withFullMarkdown } from '@cherrystudio/ui'
import { useMarkdownHost } from '@renderer/hooks/useMarkdownHost'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import { type FC, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useMarkdownComponents } from './useMarkdownComponents'

interface Props {
  children: string
  /** Stable id (heading-id prefix + block memo key). Defaults to a generated id. */
  id?: string
  className?: string
}

const STYLE_ELEMENT_REGEX = /<style\b[^>]*>/i

/**
 * Non-streaming markdown rendered with the exact same plugins and component
 * overrides as chat messages (`ChatMarkdown`), minus the streaming path. Use for
 * off-chat previews — release notes, file preview, prompt preview, agent tool
 * output. It mounts no `MarkdownHost` itself, so by default its components run in
 * their neutral, action-less mode (no code-save / table-export / citation-open
 * affordances) — but a consumer may still wrap it in a `MarkdownHostContext` (e.g.
 * the artifact file preview injects `openFilePath`).
 */
export const StaticMarkdown: FC<Props> = ({ children, id, className }) => {
  const { t } = useTranslation()
  const generatedId = useId()
  const blockId = id ?? generatedId
  // Drop Streamdown's link hardening only when a wrapping host can intercept file links
  // (it origin-resolves relative hrefs `./x` → `/x`, which would defeat that). Without such
  // a host (release notes, prompt preview, …) keep it on for the safe default link treatment.
  const { openFilePath } = useMarkdownHost()

  const plugins = useMemo(() => withFullMarkdown(), [])
  const content = useMemo(() => removeSvgEmptyLines(processLatexBrackets(children)), [children])
  const hasStyleElement = STYLE_ELEMENT_REGEX.test(content)
  const components = useMarkdownComponents({ blockId, hasStyleElement, isStreaming: false })

  return (
    <Markdown
      id={blockId}
      plugins={plugins}
      components={components}
      className={className}
      footnoteLabel={t('common.footnotes')}
      disableLinkHardening={!!openFilePath}>
      {content}
    </Markdown>
  )
}
