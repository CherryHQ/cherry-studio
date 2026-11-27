import '@cherrystudio/ui/components/composites/markdown/styles'
import type { Root } from 'mdast'
import { memo, useId } from 'react'
import type { Plugin } from 'unified'
import { visit } from 'unist-util-visit'

import { Markdown, withMath } from '@cherrystudio/ui'
import { remarkLatexMath } from '@renderer/utils/remarkLatexMath'

import type { BasicPreviewProps } from './types'

const MATH_PLUGINS = { math: withMath({ singleDollar: true }) }
const STREAMING_MATH_PLUGINS = { math: withMath({ singleDollar: true, streaming: true }) }

const remarkBareLatex: Plugin<[], Root> = () => (tree, file) => {
  let hasMath = false
  visit(tree, ['math', 'inlineMath'], () => {
    hasMath = true
  })

  if (!hasMath) tree.children = [{ type: 'code', lang: 'math', value: String(file) }]
}

const REMARK_PLUGINS = [remarkLatexMath, remarkBareLatex]

const LatexPreview = ({ children, isStreaming }: BasicPreviewProps) => {
  const id = useId()

  return (
    <Markdown
      id={id}
      plugins={isStreaming ? STREAMING_MATH_PLUGINS : MATH_PLUGINS}
      remarkPlugins={REMARK_PLUGINS}
      className="latex-preview special-preview min-w-0 overflow-x-auto px-4 py-3 text-foreground [&_.katex-display]:m-0">
      {children.trimStart()}
    </Markdown>
  )
}

export default memo(LatexPreview)
