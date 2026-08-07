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

import type { Citation } from '@renderer/types/message'
import { isLinkableCitationUrl } from '@renderer/utils/citation'
import { cn } from '@renderer/utils/style'
import { omit } from 'es-toolkit/compat'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Node } from 'unist'

import CitationTooltip from './CitationTooltip'

interface CitationSupProps extends React.HTMLAttributes<HTMLElement> {
  node?: Omit<Node, 'type'>
  'data-citation'?: string
  citationRegistry?: ReadonlyMap<number, Citation>
}

const CitationSup: React.FC<CitationSupProps> = (props) => {
  const { t } = useTranslation()
  const raw = props['data-citation']
  const citation = useMemo(() => {
    if (!raw) return null
    const number = Number(raw)
    return Number.isSafeInteger(number) && number > 0 ? (props.citationRegistry?.get(number) ?? null) : null
  }, [props.citationRegistry, raw])

  const supProps = omit(props, ['node', 'citationRegistry'])

  // A citation with a linkable URL is emitted wrapped in `[…](url)`, and `Link` reads the same
  // `data-citation` off this sup to mount the tooltip on the anchor. Mounting a second one here
  // would nest two tooltips around the same badge. The predicate must be the one
  // `generateCitationTag` branches on, or migrated v1 citations whose URL is a bare file path
  // fall through both paths and lose the tooltip entirely.
  if (!citation || isLinkableCitationUrl(citation.url)) return <sup {...supProps} />

  // The badge is the Radix trigger itself, so these semantics make it keyboard reachable.
  // `role="button"` is required, not decoration: `sup` maps to the `superscript` role, whose
  // name-from is prohibited, so a bare `aria-label` would be dropped. The focus ring has to be a
  // ring (box-shadow) rather than an outline — the `app` layer resets `*:focus { outline-style:
  // none }` and, being last, beats any `utilities`-layer outline utility.
  //
  // The label must carry the number: `role="button"` also turns on name-from-content, so a
  // constant string would override the badge's own text and make every citation on the page
  // announce identically, cutting the link to the sources footer. Without a number, fall through
  // to name-from-content rather than announcing a bare noun.
  return (
    <CitationTooltip citation={citation}>
      <sup
        {...supProps}
        role="button"
        tabIndex={0}
        aria-label={t('message.citation_source', { number: citation.number })}
        className={cn(supProps.className, 'rounded-sm focus-visible:bg-accent focus-visible:outline-none')}
      />
    </CitationTooltip>
  )
}

export default CitationSup
