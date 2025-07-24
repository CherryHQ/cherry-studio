import { defineBasicExtension } from 'prosekit/basic'
import { union } from 'prosekit/core'
import { defineCodeBlock, defineCodeBlockShiki } from 'prosekit/extensions/code-block'
import { defineHorizontalRule } from 'prosekit/extensions/horizontal-rule'
import { defineMention } from 'prosekit/extensions/mention'
import { definePlaceholder } from 'prosekit/extensions/placeholder'
import { defineReactNodeView, type ReactNodeViewComponent } from 'prosekit/react'

import CodeBlockView from './CodeBlockView'
import ImageView from './ImageView'
import { defineImageFileHandlers } from './UploadFile'

export function defineExtension(options?: { placeholder?: string }) {
  const { placeholder = 'Press / for commands...' } = options || {}

  return union(
    defineBasicExtension(),
    definePlaceholder({ placeholder }),
    defineMention(),
    defineCodeBlock(),
    defineCodeBlockShiki(),
    defineHorizontalRule(),
    defineReactNodeView({
      name: 'codeBlock',
      contentAs: 'code',
      component: CodeBlockView satisfies ReactNodeViewComponent
    }),
    defineReactNodeView({
      name: 'image',
      component: ImageView satisfies ReactNodeViewComponent
    }),
    defineImageFileHandlers()
  )
}

export type EditorExtension = ReturnType<typeof defineExtension>
