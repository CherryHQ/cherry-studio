import { describe, expect, it } from 'vitest'

import { emptyRegistry, reconcileRegistry } from '../registry'
import { transformJsx } from '../transform'

const originalOptions = { sourceFile: 'src/renderer/pages/account/AccountPanel.tsx' }
const movedOptions = { sourceFile: 'src/renderer/pages/billing/AccountPanel.tsx' }

describe('UI contract registry reconciliation', () => {
  it('keeps the ID across an unambiguous structural move', () => {
    const original = transformJsx('const AccountPanel = () => <section />', originalOptions)
    const first = reconcileRegistry(emptyRegistry(), original.descriptors)
    const moved = transformJsx('const AccountPanel = () => <section aria-busy="false" />', movedOptions)
    const second = reconcileRegistry(first, moved.descriptors)

    expect(moved.descriptors[0].anchorHash).not.toBe(original.descriptors[0].anchorHash)
    expect(moved.descriptors[0].fingerprintHash).toBe(original.descriptors[0].fingerprintHash)
    expect(second.nodes[0][2]).toBe(first.nodes[0][2])
  })

  it('keeps only the fields required to reconcile identity', () => {
    const result = transformJsx('const AccountPanel = () => <section data-ui="account.panel" />', originalOptions)
    const registry = reconcileRegistry(emptyRegistry(), result.descriptors)

    expect(registry).toEqual({
      nodes: [[result.descriptors[0].anchorHash, result.descriptors[0].fingerprintHash, registry.nodes[0][2]]],
      version: 1
    })
    expect(registry.nodes[0][2]).toMatch(/^ui-[0-9a-f]{16}$/)
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
    const oldSectionIds = new Set(
      original.descriptors
        .filter((descriptor) => descriptor.element === 'section')
        .map((descriptor) => oldIdByAnchor.get(descriptor.anchorHash)!)
    )
    const newSectionIds = second.nodes
      .filter((node) =>
        moved.descriptors.some((descriptor) => descriptor.element === 'section' && descriptor.anchorHash === node[0])
      )
      .map((node) => node[2])

    expect(newIdByAnchor.get(newDiv.anchorHash)).toBe(oldIdByAnchor.get(oldDiv.anchorHash))
    expect(newSectionIds.every((id) => !oldSectionIds.has(id))).toBe(true)
  })
})
