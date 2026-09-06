import type { BrowserRef, SnapshotNode } from '../browserUse'
import type { CdpAccessibilityNode } from './accessibilityTypes'
import type { RawSnapshot } from './captureSnapshot'

const interactiveRoles = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'option',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'searchbox'
])
const textRoles = new Set(['heading', 'text', 'statictext', 'img', 'image', 'listitem', 'cell', 'row'])
const states = new Set(['disabled', 'checked', 'expanded', 'required', 'selected', 'pressed', 'level'])
const text = (value: unknown, limit = 200) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''

export function buildSnapshotTree(
  raw: RawSnapshot,
  allocateRef: (backendNodeId: number) => BrowserRef,
  scope?: number
) {
  const document = raw.dom?.documents.find((doc) => raw.dom!.strings[doc.frameId] === raw.frameId)
  if (raw.dom && !document) throw new Error('Main frame DOM snapshot is unavailable')
  const strings = raw.dom?.strings ?? []
  const domById = new Map(document?.nodes.backendNodeId.map((id, index) => [id, index]) ?? [])
  const layoutByIndex = new Map(document?.layout.nodeIndex.map((index, row) => [index, row]) ?? [])
  const axById = new Map(raw.ax.map((node) => [node.nodeId, node]))
  const axIds = new Set(raw.ax.map((node) => node.nodeId))
  const roots =
    scope === undefined
      ? raw.ax.filter((node) => !node.parentId || !axIds.has(node.parentId))
      : raw.ax.filter((node) => node.backendDOMNodeId === scope)
  const stack = roots.toReversed().map((node) => ({ node, depth: 0 }))
  const visited = new Set<string>()
  const nodes: SnapshotNode[] = []
  let omittedNodes = 0
  while (stack.length) {
    const { node, depth } = stack.pop()!
    if (visited.has(node.nodeId)) continue
    visited.add(node.nodeId)
    if (node.frameId && node.frameId !== raw.frameId) continue
    const id = node.backendDOMNodeId
    const index = id === undefined ? undefined : domById.get(id)
    const row = index === undefined ? undefined : layoutByIndex.get(index)
    const attributes = new Map<string, string>()
    const attrs = index === undefined ? [] : (document!.nodes.attributes[index] ?? [])
    for (let i = 0; i < attrs.length; i += 2) attributes.set(strings[attrs[i]], strings[attrs[i + 1]])
    const tag = index === undefined ? '' : strings[document!.nodes.nodeName[index]]?.toLowerCase()
    const password = attributes.get('type')?.toLowerCase() === 'password'
    const role = text(node.role?.value).toLowerCase()
    const name = text(node.name?.value)
    const styles = row === undefined ? [] : document!.layout.styles[row].map((i) => strings[i])
    const rect = row === undefined ? undefined : document!.layout.bounds[row]
    const visible = !raw.dom
      ? !node.ignored
      : rect &&
        rect[2] > 0 &&
        rect[3] > 0 &&
        styles[1] !== 'none' &&
        !['hidden', 'collapse'].includes(styles[2]) &&
        (styles[3] === '' || Number(styles[3]) > 0)
    const interactive =
      interactiveRoles.has(role) ||
      styles[0] === 'pointer' ||
      attributes.has('onclick') ||
      (attributes.has('tabindex') && Number(attributes.get('tabindex')) >= 0) ||
      (attributes.has('contenteditable') && attributes.get('contenteditable') !== 'false')
    const keep = visible && (interactive || (!node.ignored && textRoles.has(role) && name))
    let emitted = false
    if (keep && id !== undefined) {
      const { x, y, w, h } = raw.viewport
      if (
        !rect ||
        (rect[1] + rect[3] >= y - 1000 && rect[1] <= y + h + 1000 && rect[0] + rect[2] >= x && rect[0] <= x + w)
      ) {
        const props = (node.properties ?? [])
          .filter((p) => states.has(p.name) && p.value?.value !== false && p.value?.value !== undefined)
          .map((p) => (p.value?.value === true ? p.name : `${p.name}=${String(p.value?.value)}`))
        if (attributes.has('href')) props.push(`href=${text(attributes.get('href'))}`)
        const value = password || !raw.dom ? undefined : text(node.value?.value, 80) || undefined
        nodes.push({
          backendNodeId: id,
          ref: interactive ? allocateRef(id) : undefined,
          role: role || tag || 'generic',
          name,
          value,
          props,
          depth,
          inViewport: !!rect && rect[1] + rect[3] >= y && rect[1] <= y + h
        })
        emitted = true
      } else omittedNodes++
    }
    // Editable descendants can repeat a password or the value already carried by the control.
    if (
      password ||
      (!raw.dom && ['textbox', 'searchbox', 'combobox'].includes(role)) ||
      ['input', 'textarea', 'iframe'].includes(tag ?? '')
    )
      continue
    for (const childId of (node.childIds ?? []).toReversed()) {
      const child: CdpAccessibilityNode | undefined = axById.get(childId)
      if (child) stack.push({ node: child, depth: depth + (emitted ? 1 : 0) })
    }
  }
  return { nodes, omittedNodes }
}
