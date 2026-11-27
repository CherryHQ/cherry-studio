import type { CherryUIMessage } from '@shared/data/types/message'

import type { AgentPartChange } from '../types'

type Fragment = { text?: string }

/** An IM or diagnostics reader needs visible text for the current reply. */
export class StreamReplyText {
  private order: Fragment[] = []
  private readonly byId = new Map<string, Fragment>()

  reset(message: CherryUIMessage): void {
    this.byId.clear()
    this.order = message.parts.map((part, index) => {
      const id = message.partIds?.[index]
      const fragment = { text: part.type === 'text' ? part.text : undefined }
      if (id) this.byId.set(id, fragment)
      return fragment
    })
  }

  apply(change: AgentPartChange): boolean {
    switch (change.type) {
      case 'part-open': {
        if (this.byId.has(change.partId)) return false
        const fragment = { text: change.kind === 'text' ? '' : undefined }
        this.order.push(fragment)
        this.byId.set(change.partId, fragment)
        return false
      }
      case 'part-append': {
        const fragment = this.byId.get(change.partId)
        if (fragment?.text === undefined) return false
        fragment.text += change.text
        return true
      }
      case 'part-correct': {
        const fragment = this.byId.get(change.partId)
        if (!fragment || change.part.type !== 'text') return false
        fragment.text = change.part.text
        return true
      }
      case 'part-finish':
        return false
      case 'part-add':
      case 'part-put':
        return false
      default:
        return change satisfies never
    }
  }

  read(): string {
    return this.order.map((part) => part.text).join('')
  }
}
