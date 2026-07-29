/**
 * `<sup>` renderer for citations that are not links.
 *
 * Web citations are emitted as `[<sup …>N</sup>](url)` and mount their tooltip
 * through `Link`. Knowledge-base and memory citations have no URL, so
 * `generateCitationTag` emits a bare `<sup>` for them — an empty-href markdown
 * link would be rewritten by rehype-harden into `<span>… [blocked]</span>`,
 * losing both the marker's look and the tooltip. This component mounts the
 * tooltip for that case.
 *
 * Every other `<sup>` in the document (footnote refs, plain markup) carries no
 * `data-citation` and passes through untouched.
 */

import { isLinkableCitationUrl } from '@renderer/utils/citation'
import { parseJSON } from '@renderer/utils/json'
import { cn } from '@renderer/utils/style'
import { omit } from 'es-toolkit/compat'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Node } from 'unist'

import CitationTooltip, { CitationSchema } from './CitationTooltip'

interface CitationSupProps extends React.HTMLAttributes<HTMLElement> {
  node?: Omit<Node, 'type'>
  'data-citation'?: string
}

const CitationSup: React.FC<CitationSupProps> = (props) => {
  const { t } = useTranslation()
  const raw = props['data-citation']
  const citation = useMemo(() => {
    if (!raw) return null
    const parsed = CitationSchema.safeParse(parseJSON(raw))
    return parsed.success ? parsed.data : null
  }, [raw])

  const supProps = omit(props, ['node'])

  // A citation with a linkable URL is emitted wrapped in `[…](url)`, and `Link` reads the same
  // `data-citation` off this sup to mount the tooltip on the anchor. Mounting a second one here
  // would nest two tooltips around the same badge. The predicate must be the one
  // `generateCitationTag` branches on, or migrated v1 citations whose URL is a bare file path
  // fall through both paths and lose the tooltip entirely.
  if (!citation || isLinkableCitationUrl(citation.url)) return <sup {...supProps} />

  // The Tooltip trigger is a plain div, so without these the badge is unreachable by keyboard.
  // `role="button"` is required, not decoration: `sup` maps to the `superscript` role, whose
  // name-from is prohibited, so a bare `aria-label` would be dropped. The focus ring has to be a
  // ring (box-shadow) rather than an outline — the `app` layer resets `*:focus { outline-style:
  // none }` and, being last, beats any `utilities`-layer outline utility.
  return (
    <CitationTooltip citation={citation}>
      <sup
        {...supProps}
        role="button"
        tabIndex={0}
        aria-label={t('message.citation_source')}
        className={cn(supProps.className, 'focus-visible:ring-2 focus-visible:ring-primary')}
      />
    </CitationTooltip>
  )
}

export default CitationSup
