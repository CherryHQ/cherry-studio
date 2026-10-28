/** Shared indented-mask container events. Fence masking and HTML ownership remain separate. */
export type Container = { id: number; parent: number; kind: 'quote' | 'item'; width: number; empty: boolean }
export type ContainerEvent = { kind: 'open' | 'close' | 'content' | 'blank'; id: number; parent: number; at: number }
export interface ContainerState {
  stack: Container[]
  nextId: number
  paragraph: number | null
  code: number | null
  fence: { owner: number; char: string; length: number; indent: number } | null
}
export const initialContainerState = (): ContainerState => ({
  stack: [],
  nextId: 1,
  paragraph: null,
  code: null,
  fence: null
})
export function cloneContainerState(state: ContainerState): ContainerState {
  return {
    ...state,
    stack: state.stack.map((container) => ({ ...container })),
    fence: state.fence ? { ...state.fence } : null
  }
}
export interface ContainerLineRecord {
  rawStart: number
  rawEnd: number
  events: ContainerEvent[]
  code: boolean
  content: string
}
/** Classify original raw lines before any length-changing literal masks. */
export function containerLines(
  raw: string,
  seed?: ContainerState
): { lines: ContainerLineRecord[]; state: ContainerState } {
  const state = seed ? cloneContainerState(seed) : initialContainerState()
  const lines: ContainerLineRecord[] = []
  const endings = /\r\n|\r|\n/g
  let start = 0
  for (const match of raw.matchAll(endings)) {
    const out = containerLine(state, raw.slice(start, match.index))
    lines.push({
      ...out,
      rawStart: start,
      rawEnd: match.index + match[0].length,
      events: out.events.map((event) => ({ ...event, at: event.at + start }))
    })
    start = match.index + match[0].length
  }
  // An unterminated tail is intentionally excluded. The caller owns it until
  // complete or final flush, so a partial marker cannot mutate committed state.
  return { lines, state }
}
const spaces = (s: string, p: number) => /^ */.exec(s.slice(p))![0].length
const thematic = (s: string) => /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/.test(s)
const marker = (s: string) => (thematic(s) ? null : /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)(.*)$/.exec(s))
const interrupts = (s: string) =>
  /^ {0,3}(?:>|#{1,6}(?: |$)|`{3,}|~{3,})/.test(s) ||
  /^[\uE000-\uF8FF]+CODE_FENCE_\d+\uE001[ \t]*$/.test(s.trim()) ||
  thematic(s) ||
  (() => {
    const m = marker(s)
    return m && m[4].trim() !== '' && (!/^\d/.test(m[2]) || /^0*1[.)]$/.test(m[2]))
  })()
export function containerLine(
  state: ContainerState,
  raw: string
): { events: ContainerEvent[]; code: boolean; content: string } {
  // Expanded columns are classification coordinates only. Events retain raw line offsets.
  let expanded = ''
  const rawAt: number[] = []
  for (let i = 0; i < raw.length; i++) {
    const part = raw[i] === '\t' ? ' '.repeat(4 - (expanded.length % 4)) : raw[i]
    for (let column = 0; column < part.length; column++) rawAt.push(i)
    expanded += part
  }
  rawAt.push(raw.length)
  const rawOffset = (at: number) => rawAt[Math.min(at, expanded.length)]
  const events: ContainerEvent[] = []
  let p = 0
  let matched = 0
  let lazy = false
  const owner = () => state.stack[state.stack.length - 1]?.id ?? 0
  const markContent = (at: number) => {
    for (const c of state.stack) {
      if (c.empty) {
        c.empty = false
        events.push({ kind: 'content', id: c.id, parent: c.parent, at: rawOffset(at) })
      }
    }
  }
  const close = (from: number) => {
    for (let k = state.stack.length - 1; k >= from; k--) {
      const c = state.stack[k]
      events.push({ kind: 'close', id: c.id, parent: c.parent, at: rawOffset(p) })
    }
    if (state.fence && state.stack.slice(from).some((container) => container.id === state.fence!.owner))
      state.fence = null
    state.stack.length = from
  }
  for (; matched < state.stack.length; matched++) {
    const c = state.stack[matched]
    const rest = expanded.slice(p)
    const n = spaces(expanded, p)
    if (c.kind === 'quote') {
      const q = /^ {0,3}> ?/.exec(rest)
      if (q) {
        p += q[0].length
        continue
      }
    } else if (rest.trim() === '') {
      if (!c.empty) continue
    } else if (n >= c.width) {
      p += c.width
      continue
    }
    // A marker at an existing item's boundary starts a sibling even when
    // empty. This is not the rule for a new list interrupting a paragraph.
    const sibling = c.kind === 'item' && marker(rest) !== null
    if (!sibling && state.paragraph !== null && rest.trim() !== '' && !interrupts(rest)) {
      lazy = true
      matched = state.stack.length
      break
    }
    close(matched)
    state.paragraph = null
    state.code = null
    break
  }
  if (lazy) {
    markContent(p)
    return { events, code: false, content: expanded.slice(p) }
  }
  let rest = expanded.slice(p)
  if (state.fence) {
    const run = /^ {0,3}([`~])\1{2,}[ \t]*$/.exec(rest)
    const close = run && run[1] === state.fence.char && rest.trim().length >= state.fence.length
    if (close) state.fence = null
    state.paragraph = null
    return { events, code: true, content: rest }
  }
  if (rest.trim() === '') {
    state.paragraph = null
    state.code = null
    for (const c of state.stack) events.push({ kind: 'blank', id: c.id, parent: c.parent, at: rawOffset(p) })
    return { events, code: false, content: rest }
  }
  // Existing paragraph cannot be interrupted by indentation or an empty item.
  if (state.paragraph === owner() && !interrupts(rest)) {
    if (/^ {0,3}(?:=+|-+)[ \t]*$/.test(rest)) state.paragraph = null
    markContent(p)
    return { events, code: false, content: rest }
  }
  for (;;) {
    rest = expanded.slice(p)
    if (spaces(expanded, p) >= 4) break
    const q = /^ {0,3}> ?/.exec(rest)
    const m = marker(rest)
    if (!q && !m) break
    markContent(p)
    const parent = owner()
    const c: Container = { id: state.nextId++, parent, kind: q ? 'quote' : 'item', width: 0, empty: true }
    if (q) p += q[0].length
    else {
      const pad = m![4].trim() !== '' && m![3].length <= 4 ? m![3].length : 1
      c.width = m![1].length + m![2].length + pad
      p += Math.min(c.width, rest.length)
    }
    state.stack.push(c)
    events.push({ kind: 'open', id: c.id, parent, at: rawOffset(p) })
    state.paragraph = null
    state.code = null
  }
  rest = expanded.slice(p)
  if (rest.trim() === '') {
    state.paragraph = null
    state.code = null
    return { events, code: false, content: rest }
  }
  const fence = /^ {0,3}([`~])\1{2,}/.exec(rest)
  if (fence && (fence[1] !== '`' || !rest.slice(fence[0].length).includes('`'))) {
    markContent(p)
    const run = fence[0].trim()
    state.fence = { owner: owner(), char: run[0], length: run.length, indent: fence[0].length - run.length }
    state.paragraph = null
    state.code = null
    return { events, code: true, content: rest }
  }
  const code = spaces(expanded, p) >= 4
  markContent(p)
  state.code = code ? owner() : null
  state.paragraph =
    code || interrupts(rest) || /^[\uE000-\uF8FF]+CODE_FENCE_\d+\uE001[ \t]*$/.test(rest.trim()) ? null : owner()
  return { events, code, content: rest }
}

/** Compatibility projection for existing carry clients; never used as ownership authority. */
export function legacyContainerView(state: ContainerState): {
  listColumnStack: Array<{ column: number; quoteDepth: number }>
  inheritedListColumns: number
  listInsideQuote: boolean
  paragraphOpen: boolean
  quoteDepth: number
} {
  const listColumnStack: Array<{ column: number; quoteDepth: number }> = []
  let quoteDepth = 0
  let column = 0
  for (const container of state.stack) {
    if (container.kind === 'quote') {
      quoteDepth++
      column = 0
    } else {
      column += container.width
      listColumnStack.push({ column, quoteDepth })
    }
  }
  return {
    listColumnStack,
    inheritedListColumns: listColumnStack[listColumnStack.length - 1]?.column ?? 0,
    listInsideQuote: listColumnStack.some((entry) => entry.quoteDepth > 0),
    paragraphOpen: state.paragraph !== null,
    quoteDepth
  }
}
