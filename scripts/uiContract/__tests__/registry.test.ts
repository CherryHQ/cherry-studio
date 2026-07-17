import { describe, expect, it } from 'vitest'

import { emptyRegistry, reconcileRegistry } from '../registry'
import { transformJsx } from '../transform'

const originalOptions = { sourceFile: 'src/renderer/pages/account/AccountPanel.tsx' }
const movedOptions = { sourceFile: 'src/renderer/pages/billing/AccountPanel.tsx' }

describe('UI contract registry reconciliation', () => {
  it('keeps the ID and re-infers the semantic when a file moves with edits', () => {
    const original = transformJsx('const AccountPanel = () => <section />', originalOptions)
    const first = reconcileRegistry(emptyRegistry(), original.descriptors)
    const moved = transformJsx('const AccountPanel = () => <section aria-busy="false" />', movedOptions)
    const second = reconcileRegistry(first, moved.descriptors)

    expect(moved.descriptors[0].anchorHash).not.toBe(original.descriptors[0].anchorHash)
    expect(moved.descriptors[0].fingerprintHash).toBe(original.descriptors[0].fingerprintHash)
    expect(second.nodes[0][2]).toBe(first.nodes[0][2])
    expect(second.nodes[0][3]).toBe(moved.descriptors[0].semanticId)
    expect(second.retiredIds).toEqual([])
  })

  it('keeps the ID when an explicitly named node moves without a Git-detected rename', () => {
    const original = transformJsx('const AccountPanel = () => <section data-ui="account.panel" />', originalOptions)
    const first = reconcileRegistry(emptyRegistry(), original.descriptors)
    const moved = transformJsx('const AccountPanel = () => <section data-ui="account.panel" />', movedOptions)
    const second = reconcileRegistry(first, moved.descriptors)

    expect(second.nodes[0][2]).toBe(first.nodes[0][2])
    expect(second.nodes[0][3]).toBe('account.panel')
    expect(second.retiredIds).toEqual([])
  })

  it('never guesses between ambiguous structural matches', () => {
    const source = 'const AccountPanel = () => <div><section /><section /></div>'
    const original = transformJsx(source, originalOptions)
    const first = reconcileRegistry(emptyRegistry(), original.descriptors)
    const moved = transformJsx(source, movedOptions)
    const second = reconcileRegistry(first, moved.descriptors)

    const oldIdByAnchor = new Map(first.nodes.map((node) => [node[0], node[2]]))
    const newIdByAnchor = new Map(second.nodes.map((node) => [node[0], node[2]]))
    const oldDiv = original.descriptors.find((descriptor) => descriptor.element === 'div')!
    const newDiv = moved.descriptors.find((descriptor) => descriptor.element === 'div')!
    const oldSectionIds = original.descriptors
      .filter((descriptor) => descriptor.element === 'section')
      .map((descriptor) => oldIdByAnchor.get(descriptor.anchorHash)!)

    expect(newIdByAnchor.get(newDiv.anchorHash)).toBe(oldIdByAnchor.get(oldDiv.anchorHash))
    expect([...second.retiredIds].sort()).toEqual([...oldSectionIds].sort())
  })
})
