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

  it('does not let a prepended indistinguishable sibling take an existing ID', () => {
    const original = transformJsx(
      'const AccountPanel = () => <div><section>first</section><section>second</section></div>',
      originalOptions
    )
    const first = reconcileRegistry(emptyRegistry(), original.descriptors)
    const prepended = transformJsx(
      'const AccountPanel = () => <div><section>new</section><section>first</section><section>second</section></div>',
      originalOptions
    )
    const second = reconcileRegistry(first, prepended.descriptors)
    const stable = reconcileRegistry(second, prepended.descriptors)

    const originalSections = original.descriptors.filter((descriptor) => descriptor.element === 'section')
    const prependedSections = prepended.descriptors.filter((descriptor) => descriptor.element === 'section')
    const originalDiv = original.descriptors.find((descriptor) => descriptor.element === 'div')!
    const prependedDiv = prepended.descriptors.find((descriptor) => descriptor.element === 'div')!
    const oldIdByAnchor = new Map(first.nodes.map((node) => [node[0], node[2]]))
    const newIdByAnchor = new Map(second.nodes.map((node) => [node[0], node[2]]))
    const oldSectionIds = new Set(originalSections.map((descriptor) => oldIdByAnchor.get(descriptor.anchorHash)!))
    const newSectionIds = prependedSections.map((descriptor) => newIdByAnchor.get(descriptor.anchorHash)!)

    expect(prependedSections[0].anchorHash).toBe(originalSections[0].anchorHash)
    expect(newIdByAnchor.get(prependedDiv.anchorHash)).toBe(oldIdByAnchor.get(originalDiv.anchorHash))
    expect(newSectionIds.every((id) => !oldSectionIds.has(id))).toBe(true)
    expect(stable).toEqual(second)
  })

  it('does not let a remaining indistinguishable sibling take a removed sibling ID', () => {
    const original = transformJsx(
      'const AccountPanel = () => <div><section>first</section><section>second</section><section>third</section></div>',
      originalOptions
    )
    const first = reconcileRegistry(emptyRegistry(), original.descriptors)
    const removed = transformJsx(
      'const AccountPanel = () => <div><section>second</section><section>third</section></div>',
      originalOptions
    )
    const second = reconcileRegistry(first, removed.descriptors)

    const oldIdByAnchor = new Map(first.nodes.map((node) => [node[0], node[2]]))
    const newIdByAnchor = new Map(second.nodes.map((node) => [node[0], node[2]]))
    const oldSectionIds = new Set(
      original.descriptors
        .filter((descriptor) => descriptor.element === 'section')
        .map((descriptor) => oldIdByAnchor.get(descriptor.anchorHash)!)
    )
    const newSectionIds = removed.descriptors
      .filter((descriptor) => descriptor.element === 'section')
      .map((descriptor) => newIdByAnchor.get(descriptor.anchorHash)!)

    expect(newSectionIds.every((id) => !oldSectionIds.has(id))).toBe(true)
  })

  it('keeps another file stable when a shared fingerprint cohort changes', () => {
    const source = 'const AccountPanel = () => <div><section /></div>'
    const account = transformJsx(source, originalOptions)
    const billing = transformJsx(source, movedOptions)
    const first = reconcileRegistry(emptyRegistry(), [...account.descriptors, ...billing.descriptors])
    const changedBilling = transformJsx('const AccountPanel = () => <div><section /><section /></div>', movedOptions)
    const second = reconcileRegistry(first, [...account.descriptors, ...changedBilling.descriptors])

    const accountSection = account.descriptors.find((descriptor) => descriptor.element === 'section')!
    const billingSection = billing.descriptors.find((descriptor) => descriptor.element === 'section')!
    const oldIdByAnchor = new Map(first.nodes.map((node) => [node[0], node[2]]))
    const newIdByAnchor = new Map(second.nodes.map((node) => [node[0], node[2]]))
    const oldBillingId = oldIdByAnchor.get(billingSection.anchorHash)!
    const newBillingIds = changedBilling.descriptors
      .filter((descriptor) => descriptor.element === 'section')
      .map((descriptor) => newIdByAnchor.get(descriptor.anchorHash)!)

    expect(accountSection.fingerprintHash).toBe(billingSection.fingerprintHash)
    expect(newIdByAnchor.get(accountSection.anchorHash)).toBe(oldIdByAnchor.get(accountSection.anchorHash))
    expect(newBillingIds).not.toContain(oldBillingId)
  })

  it('keeps another parent context stable when a shared fingerprint cohort changes', () => {
    const original = transformJsx(
      'const AccountPanel = () => <main><div data-ui="one.account.shared.parent"><section /></div><div data-ui="two.account.shared.parent"><section /></div></main>',
      originalOptions
    )
    const first = reconcileRegistry(emptyRegistry(), original.descriptors)
    const changed = transformJsx(
      'const AccountPanel = () => <main><div data-ui="one.account.shared.parent"><section /></div><div data-ui="two.account.shared.parent"><section /><section /></div></main>',
      originalOptions
    )
    const second = reconcileRegistry(first, changed.descriptors)

    const originalSections = original.descriptors.filter((descriptor) => descriptor.element === 'section')
    const unchangedSection = changed.descriptors.find(
      (descriptor) => descriptor.element === 'section' && descriptor.anchorCohort === originalSections[0].anchorCohort
    )!
    const changedSections = changed.descriptors.filter(
      (descriptor) => descriptor.element === 'section' && descriptor.anchorCohort === originalSections[1].anchorCohort
    )
    const oldIdByAnchor = new Map(first.nodes.map((node) => [node[0], node[2]]))
    const newIdByAnchor = new Map(second.nodes.map((node) => [node[0], node[2]]))
    const oldChangedId = oldIdByAnchor.get(originalSections[1].anchorHash)!

    expect(originalSections[0].fingerprintHash).toBe(originalSections[1].fingerprintHash)
    expect(originalSections[0].anchorCohort).not.toBe(originalSections[1].anchorCohort)
    expect(newIdByAnchor.get(unchangedSection.anchorHash)).toBe(oldIdByAnchor.get(originalSections[0].anchorHash))
    expect(changedSections.map((descriptor) => newIdByAnchor.get(descriptor.anchorHash)!)).not.toContain(oldChangedId)
  })
})
