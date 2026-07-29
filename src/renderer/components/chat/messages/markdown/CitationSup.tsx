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

import { parseJSON } from '@renderer/utils/json'
import { omit } from 'es-toolkit/compat'
import React, { useMemo } from 'react'
import type { Node } from 'unist'

import CitationTooltip, { CitationSchema } from './CitationTooltip'

interface CitationSupProps extends React.HTMLAttributes<HTMLElement> {
  node?: Omit<Node, 'type'>
  'data-citation'?: string
}

const CitationSup: React.FC<CitationSupProps> = (props) => {
  const raw = props['data-citation']
  const citation = useMemo(() => {
    if (!raw) return null
    const parsed = CitationSchema.safeParse(parseJSON(raw))
    return parsed.success ? parsed.data : null
  }, [raw])

  const supProps = omit(props, ['node'])

  if (!citation) return <sup {...supProps} />

  return (
    <CitationTooltip citation={citation}>
      <sup {...supProps} />
    </CitationTooltip>
  )
}

export default CitationSup
