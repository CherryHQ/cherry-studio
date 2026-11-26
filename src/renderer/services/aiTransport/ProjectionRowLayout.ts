import type { ProjectionLayoutNode, ProjectionLayoutSlot, ProjectionRowReader } from '@renderer/types/message'
import type { CherryMessagePart } from '@shared/data/types/message'

const FANOUT = 32

export interface RowPart {
  id: string
  value: CherryMessagePart
  layout: ProjectionLayoutSlot
  text: boolean
  page?: Page
}
interface Page {
  parent?: Page
  body: { parts: RowPart[] } | { pages: Page[] }
  view: ProjectionLayoutNode
  lastText?: string
}

function refreshView(page: Page): void {
  const { body } = page
  if ('pages' in body) {
    page.view = { children: body.pages.map((child) => child.view) }
    page.lastText = body.pages.findLast((child) => child.lastText !== undefined)?.lastText
  } else {
    page.view = { slots: body.parts.map((part) => part.layout) }
    page.lastText = body.parts.findLast((part) => part.text)?.id
  }
}

function makePage(body: Page['body']): Page {
  const page: Page = { body, view: { slots: [] } }
  if ('pages' in body) for (const child of body.pages) child.parent = page
  else for (const part of body.parts) part.page = page
  refreshView(page)
  return page
}

/** Leaves own contiguous parts. An anchor points to its leaf and each level has bounded fanout. */
export class ProjectionRowLayout implements ProjectionRowReader {
  private first!: Page
  private root!: Page
  private listeners?: Set<() => void>

  constructor(parts: RowPart[]) {
    this.reset(parts)
  }

  reset(parts: RowPart[]): void {
    let level: Page[] = []
    for (let i = 0; i < parts.length; i += FANOUT) level.push(makePage({ parts: parts.slice(i, i + FANOUT) }))
    this.first = level[0] ?? makePage({ parts: [] })
    while (level.length > 1) {
      const parents: Page[] = []
      for (let i = 0; i < level.length; i += FANOUT) parents.push(makePage({ pages: level.slice(i, i + FANOUT) }))
      level = parents
    }
    this.root = level[0] ?? this.first
  }

  readonly getSnapshot = (): ProjectionLayoutNode => this.root.view
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners ??= new Set()
    this.listeners.add(listener)
    return () => this.listeners?.delete(listener)
  }

  notify(): void {
    this.listeners?.forEach((listener) => listener())
  }

  append(part: RowPart): void {
    let leaf = this.root
    while ('pages' in leaf.body) leaf = leaf.body.pages[leaf.body.pages.length - 1]
    leaf.body.parts.push(part)
    part.page = leaf
    this.refresh(leaf)
  }

  place(part: RowPart, after?: RowPart): void {
    const leaf = after?.page ?? this.first
    if (!('parts' in leaf.body)) throw new Error('Invalid placement anchor')
    leaf.body.parts.splice(after ? leaf.body.parts.indexOf(after) + 1 : 0, 0, part)
    part.page = leaf
    this.refresh(leaf)
  }

  change(part: RowPart): void {
    part.layout = { partId: part.id }
    this.refresh(part.page!)
  }

  previousText(part: RowPart): string | undefined {
    let page = part.page!
    if (!('parts' in page.body)) throw new Error('Invalid text anchor')
    const parts = page.body.parts
    for (let i = parts.indexOf(part) - 1; i >= 0; i--) if (parts[i].text) return parts[i].id
    while (page.parent && 'pages' in page.parent.body) {
      const siblings = page.parent.body.pages
      for (let i = siblings.indexOf(page) - 1; i >= 0; i--) if (siblings[i].lastText) return siblings[i].lastText
      page = page.parent
    }
    return undefined
  }

  forEachPart(visit: (part: RowPart) => void): void {
    function walk(page: Page) {
      if ('parts' in page.body) page.body.parts.forEach(visit)
      else page.body.pages.forEach(walk)
    }
    walk(this.root)
  }

  private refresh(page: Page): void {
    const { body } = page
    let sibling: Page | undefined
    if ('pages' in body && body.pages.length > FANOUT) sibling = makePage({ pages: body.pages.splice(FANOUT >>> 1) })
    if ('parts' in body && body.parts.length > FANOUT) sibling = makePage({ parts: body.parts.splice(FANOUT >>> 1) })
    refreshView(page)
    if (page.parent && 'pages' in page.parent.body) {
      if (sibling) {
        const peers = page.parent.body.pages
        peers.splice(peers.indexOf(page) + 1, 0, sibling)
        sibling.parent = page.parent
      }
      this.refresh(page.parent)
    } else if (sibling) this.root = makePage({ pages: [page, sibling] })
  }
}
