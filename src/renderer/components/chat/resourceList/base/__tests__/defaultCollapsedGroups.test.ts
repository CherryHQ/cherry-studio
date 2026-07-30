import { describe, expect, it } from 'vitest'

import { resolveCollapsedIdsForNewGroups, resolveDefaultCollapsedGroupIds } from '../defaultCollapsedGroups'

type Item = { id: string; group: string }

const groupBy = (item: Item) => ({ id: item.group, label: item.group })

describe('resolveDefaultCollapsedGroupIds', () => {
  it('returns the explicit collapsed ids when provided', () => {
    expect(
      resolveDefaultCollapsedGroupIds<Item>({
        collapsedIds: ['a'],
        groupBy,
        items: [{ id: '1', group: 'a' }]
      })
    ).toEqual(['a'])
  })

  it('collapses every labelled group when collapsedIds is null (never interacted)', () => {
    expect(
      resolveDefaultCollapsedGroupIds<Item>({
        collapsedIds: null,
        groupBy,
        items: [
          { id: '1', group: 'a' },
          { id: '2', group: 'b' }
        ]
      })
    ).toEqual(['a', 'b'])
  })
})

describe('resolveCollapsedIdsForNewGroups', () => {
  it('collapses a new group when every existing group is already collapsed', () => {
    expect(
      resolveCollapsedIdsForNewGroups({
        collapsedIds: ['a', 'b'],
        currentGroupIds: ['a', 'b', 'c'],
        previousGroupIds: ['a', 'b']
      })
    ).toEqual(['a', 'b', 'c'])
  })

  it('does NOT collapse the new group when some existing group is still expanded', () => {
    expect(
      resolveCollapsedIdsForNewGroups({
        collapsedIds: ['a'],
        currentGroupIds: ['a', 'b', 'c'],
        previousGroupIds: ['a', 'b']
      })
    ).toBeNull()
  })

  it('collapses multiple new groups at once when everything else is collapsed', () => {
    expect(
      resolveCollapsedIdsForNewGroups({
        collapsedIds: ['a'],
        currentGroupIds: ['a', 'c', 'd'],
        previousGroupIds: ['a']
      })
    ).toEqual(['a', 'c', 'd'])
  })

  it('returns null when there are no new groups', () => {
    expect(
      resolveCollapsedIdsForNewGroups({
        collapsedIds: ['a', 'b'],
        currentGroupIds: ['a', 'b'],
        previousGroupIds: ['a', 'b']
      })
    ).toBeNull()
  })

  it('returns null on first population (no pre-existing groups to compare against)', () => {
    expect(
      resolveCollapsedIdsForNewGroups({
        collapsedIds: [],
        currentGroupIds: ['a', 'b'],
        previousGroupIds: []
      })
    ).toBeNull()
  })

  it('returns null when the new group is already in the collapsed set', () => {
    expect(
      resolveCollapsedIdsForNewGroups({
        collapsedIds: ['a', 'b', 'c'],
        currentGroupIds: ['a', 'b', 'c'],
        previousGroupIds: ['a', 'b']
      })
    ).toBeNull()
  })

  // Regression (ousugo P1): an expanded group that disappears in the same update (its last topic
  // moves to a new assistant) must still count against the "all collapsed" check — the reference is
  // every previously observed group, not just the ones that survived into the current snapshot.
  it('does NOT collapse the new group when a disappearing group was still expanded', () => {
    expect(
      resolveCollapsedIdsForNewGroups({
        collapsedIds: ['a'],
        currentGroupIds: ['a', 'c'],
        previousGroupIds: ['a', 'b']
      })
    ).toBeNull()
  })

  // Regression (zhangjiadi A1 / ousugo P2): a group that was only temporarily absent (pinned away, or
  // not yet paged in) is already in the observed set, so its reappearance is not a new group.
  it('returns null when a previously observed group reappears', () => {
    expect(
      resolveCollapsedIdsForNewGroups({
        collapsedIds: ['a'],
        currentGroupIds: ['a', 'b'],
        previousGroupIds: ['a', 'b']
      })
    ).toBeNull()
  })
})
