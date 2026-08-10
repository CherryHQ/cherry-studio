import type { SpanEntity } from '@mcp-trace/trace-core'

import type { TraceNode, TraceVisibleRow } from './traceNode'

type MutationKind = 'incremental' | 'reset' | 'toggle'

export interface TraceTreeMutation {
  kind: MutationKind
  revision: number
  structureChanged: boolean
  previousVisibleCount: number
  visibleCount: number
}

const INITIAL_MUTATION: TraceTreeMutation = {
  kind: 'reset',
  revision: 0,
  structureChanged: false,
  previousVisibleCount: 0,
  visibleCount: 0
}

function normalizeParentId(parentId: string | null | undefined): string | null {
  return parentId || null
}

/**
 * Normalized trace tree with a pre-order projection of expanded rows.
 *
 * Full snapshots rebuild once. Incremental span field updates keep the visible-row array intact;
 * structural changes splice the moved subtree, except late-parent adoption batches that rebuild once.
 */
export class TraceTreeModel {
  private readonly nodesById = new Map<string, TraceNode>()
  private readonly attachedParentById = new Map<string, string | null>()
  private readonly expandedIds = new Set<string>()
  private readonly inFlightIds = new Set<string>()
  private readonly visibleIndexById = new Map<string, number>()
  private readonly waitingChildrenByParentId = new Map<string, Set<string>>()
  private rootIds: string[] = []
  private _visibleRows: TraceVisibleRow[] = []
  private _lastMutation = INITIAL_MUTATION
  private _virtualItemKey = (index: number): string | number => this._visibleRows[index]?.id ?? index

  get visibleRows(): readonly TraceVisibleRow[] {
    return this._visibleRows
  }

  get lastMutation(): TraceTreeMutation {
    return this._lastMutation
  }

  get virtualItemKey(): (index: number) => string | number {
    return this._virtualItemKey
  }

  get nodeCount(): number {
    return this.nodesById.size
  }

  get isIdle(): boolean {
    return this.nodesById.size === 0 || this.inFlightIds.size === 0
  }

  getNode(id: string): TraceNode | null {
    return this.nodesById.get(id) ?? null
  }

  getVisibleIndex(id: string): number | undefined {
    return this.visibleIndexById.get(id)
  }

  isExpanded(id: string): boolean {
    return this.expandedIds.has(id)
  }

  reset(spans: SpanEntity[]): TraceTreeMutation {
    const previousVisibleCount = this._visibleRows.length
    const collapsedIds = new Set([...this.nodesById.keys()].filter((nodeId) => !this.expandedIds.has(nodeId)))
    this.nodesById.clear()
    this.attachedParentById.clear()
    this.expandedIds.clear()
    this.inFlightIds.clear()
    this.visibleIndexById.clear()
    this.waitingChildrenByParentId.clear()
    this.rootIds = []

    for (const span of spans) {
      const node = this.createNode(span)
      this.nodesById.set(node.id, node)
      if (!collapsedIds.has(node.id)) this.expandedIds.add(node.id)
      this.updateInFlight(node)
    }

    for (const node of this.nodesById.values()) {
      const desiredParentId = normalizeParentId(node.parentId)
      const parent = desiredParentId && desiredParentId !== node.id ? this.nodesById.get(desiredParentId) : undefined
      if (parent) {
        parent.childIds.push(node.id)
        this.attachedParentById.set(node.id, parent.id)
      } else {
        this.rootIds.push(node.id)
        this.attachedParentById.set(node.id, null)
        if (desiredParentId && desiredParentId !== node.id) {
          const waiting = this.waitingChildrenByParentId.get(desiredParentId) ?? new Set<string>()
          waiting.add(node.id)
          this.waitingChildrenByParentId.set(desiredParentId, waiting)
        }
      }
    }

    this.rootIds.sort(this.compareNodeIds)
    for (const node of this.nodesById.values()) {
      if (node.childIds.length > 1) {
        node.childIds.sort(this.compareNodeIds)
      }
    }

    this._visibleRows = this.flattenForest()
    this.reindexVisibleRows(0)
    return this.recordMutation('reset', true, previousVisibleCount)
  }

  applySpanChanges(spans: SpanEntity[]): TraceTreeMutation | null {
    if (spans.length === 0) return null

    const previousVisibleCount = this._visibleRows.length
    let structureChanged = false

    for (const span of spans) {
      const existing = this.nodesById.get(span.id)
      if (!existing) {
        const node = this.createNode(span)
        this.nodesById.set(node.id, node)
        this.expandedIds.add(node.id)
        this.updateInFlight(node)
        this.attachNode(node.id)
        structureChanged = this.insertVisibleSubtree(node.id) || structureChanged
        structureChanged = this.adoptWaitingChildren(node.id) || structureChanged
        continue
      }

      const nextParentId = normalizeParentId(span.parentId)
      const relationshipChanged = nextParentId !== normalizeParentId(existing.parentId)
      const orderChanged = span.startTime !== existing.startTime

      if (relationshipChanged || orderChanged) {
        structureChanged = this.removeVisibleSubtree(existing.id) || structureChanged
        this.detachNode(existing.id)
      }

      const nextNode: TraceNode = {
        ...span,
        parentId: nextParentId,
        childIds: existing.childIds
      }
      this.nodesById.set(nextNode.id, nextNode)
      this.updateInFlight(nextNode)

      if (relationshipChanged || orderChanged) {
        this.attachNode(nextNode.id)
        structureChanged = this.insertVisibleSubtree(nextNode.id) || structureChanged
      }
    }

    return this.recordMutation('incremental', structureChanged, previousVisibleCount)
  }

  toggle(id: string): TraceTreeMutation | null {
    const node = this.nodesById.get(id)
    if (!node || node.childIds.length === 0) return null

    const previousVisibleCount = this._visibleRows.length
    if (this.expandedIds.delete(id)) {
      const rowIndex = this.visibleIndexById.get(id)
      if (rowIndex !== undefined) {
        const rowDepth = this._visibleRows[rowIndex]?.depth
        if (rowDepth !== undefined) {
          let endIndex = rowIndex + 1
          while (endIndex < this._visibleRows.length && this._visibleRows[endIndex].depth > rowDepth) {
            endIndex++
          }
          const removed = this._visibleRows.splice(rowIndex + 1, endIndex - rowIndex - 1)
          for (const row of removed) this.visibleIndexById.delete(row.id)
          this.reindexVisibleRows(rowIndex + 1)
        }
      }
    } else {
      this.expandedIds.add(id)
      const rowIndex = this.visibleIndexById.get(id)
      const parentRow = rowIndex === undefined ? undefined : this._visibleRows[rowIndex]
      if (rowIndex !== undefined && parentRow) {
        const rows = this.flattenChildren(node, parentRow.depth + 1, parentRow.rootId)
        this.insertVisibleRows(rowIndex + 1, rows)
        this.reindexVisibleRows(rowIndex + 1)
      }
    }

    return this.recordMutation('toggle', true, previousVisibleCount)
  }

  private createNode(span: SpanEntity): TraceNode {
    return {
      ...span,
      parentId: normalizeParentId(span.parentId),
      childIds: []
    }
  }

  private updateInFlight(node: TraceNode): void {
    if (!node.endTime || node.endTime <= 0) {
      this.inFlightIds.add(node.id)
    } else {
      this.inFlightIds.delete(node.id)
    }
  }

  private attachNode(id: string): void {
    const node = this.nodesById.get(id)
    if (!node) return

    const desiredParentId = normalizeParentId(node.parentId)
    const parent = desiredParentId && desiredParentId !== id ? this.nodesById.get(desiredParentId) : undefined
    if (parent) {
      this.replaceChildIds(parent.id, this.insertSorted(parent.childIds, id))
      this.attachedParentById.set(id, parent.id)
      return
    }

    this.rootIds = this.insertSorted(this.rootIds, id)
    this.attachedParentById.set(id, null)
    if (desiredParentId && desiredParentId !== id) {
      const waiting = this.waitingChildrenByParentId.get(desiredParentId) ?? new Set<string>()
      waiting.add(id)
      this.waitingChildrenByParentId.set(desiredParentId, waiting)
    }
  }

  private detachNode(id: string): void {
    const node = this.nodesById.get(id)
    if (!node) return

    const attachedParentId = this.attachedParentById.get(id)
    if (attachedParentId) {
      const parent = this.nodesById.get(attachedParentId)
      if (parent)
        this.replaceChildIds(
          parent.id,
          parent.childIds.filter((childId) => childId !== id)
        )
    } else {
      this.rootIds = this.rootIds.filter((rootId) => rootId !== id)
    }

    const desiredParentId = normalizeParentId(node.parentId)
    if (desiredParentId) {
      const waiting = this.waitingChildrenByParentId.get(desiredParentId)
      waiting?.delete(id)
      if (waiting?.size === 0) this.waitingChildrenByParentId.delete(desiredParentId)
    }
    this.attachedParentById.delete(id)
  }

  private adoptWaitingChildren(parentId: string): boolean {
    const waiting = this.waitingChildrenByParentId.get(parentId)
    if (!waiting?.size) return false

    const adoptedIds: string[] = []
    for (const childId of waiting) {
      const child = this.nodesById.get(childId)
      if (!child || normalizeParentId(child.parentId) !== parentId) continue
      adoptedIds.push(childId)
    }
    this.waitingChildrenByParentId.delete(parentId)
    if (adoptedIds.length === 0) return false

    const adoptedIdSet = new Set(adoptedIds)
    this.rootIds = this.rootIds.filter((rootId) => !adoptedIdSet.has(rootId))
    for (const childId of adoptedIds) this.attachedParentById.set(childId, parentId)

    const parent = this.nodesById.get(parentId)
    if (parent) {
      this.replaceChildIds(parentId, [...parent.childIds, ...adoptedIds].sort(this.compareNodeIds))
    }

    this.rebuildVisibleRows()
    return true
  }

  private replaceChildIds(parentId: string, childIds: string[]): void {
    const parent = this.nodesById.get(parentId)
    if (parent) this.nodesById.set(parentId, { ...parent, childIds })
  }

  private insertSorted(ids: string[], id: string): string[] {
    let low = 0
    let high = ids.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (this.compareNodeIds(ids[middle], id) <= 0) low = middle + 1
      else high = middle
    }
    ids.splice(low, 0, id)
    return ids
  }

  private readonly compareNodeIds = (leftId: string, rightId: string): number => {
    const left = this.nodesById.get(leftId)
    const right = this.nodesById.get(rightId)
    const startDelta = (left?.startTime ?? 0) - (right?.startTime ?? 0)
    return startDelta || leftId.localeCompare(rightId)
  }

  private flattenForest(): TraceVisibleRow[] {
    const rows: TraceVisibleRow[] = []
    for (const rootId of this.rootIds) {
      for (const row of this.flattenSubtree(rootId, 0, rootId)) rows.push(row)
    }
    return rows
  }

  private flattenChildren(node: TraceNode, depth: number, rootId: string): TraceVisibleRow[] {
    const rows: TraceVisibleRow[] = []
    for (const childId of node.childIds) {
      for (const row of this.flattenSubtree(childId, depth, rootId)) rows.push(row)
    }
    return rows
  }

  private flattenSubtree(id: string, depth: number, rootId: string): TraceVisibleRow[] {
    const rows: TraceVisibleRow[] = []
    const stack: TraceVisibleRow[] = [{ id, depth, rootId }]

    while (stack.length > 0) {
      const row = stack.pop()
      if (!row) break
      const node = this.nodesById.get(row.id)
      if (!node) continue
      rows.push(row)
      if (!this.expandedIds.has(node.id)) continue
      for (let index = node.childIds.length - 1; index >= 0; index--) {
        stack.push({ id: node.childIds[index], depth: row.depth + 1, rootId: row.rootId })
      }
    }

    return rows
  }

  private insertVisibleSubtree(id: string): boolean {
    const insertion = this.getVisibleInsertion(id)
    if (!insertion) return false

    const rows = this.flattenSubtree(id, insertion.depth, insertion.rootId)
    this.insertVisibleRows(insertion.index, rows)
    this.reindexVisibleRows(insertion.index)
    return rows.length > 0
  }

  private getVisibleInsertion(id: string): { index: number; depth: number; rootId: string } | null {
    const attachedParentId = this.attachedParentById.get(id)
    if (attachedParentId) {
      const parentIndex = this.visibleIndexById.get(attachedParentId)
      const parentRow = parentIndex === undefined ? undefined : this._visibleRows[parentIndex]
      const parent = this.nodesById.get(attachedParentId)
      if (parentIndex === undefined || !parentRow || !parent || !this.expandedIds.has(attachedParentId)) return null

      const siblingIndex = this.findSortedIndex(parent.childIds, id)
      const previousSiblingId = siblingIndex > 0 ? parent.childIds[siblingIndex - 1] : undefined
      const index = previousSiblingId ? this.getVisibleSubtreeEnd(previousSiblingId) : parentIndex + 1
      return { index, depth: parentRow.depth + 1, rootId: parentRow.rootId }
    }

    const rootIndex = this.findSortedIndex(this.rootIds, id)
    const previousRootId = rootIndex > 0 ? this.rootIds[rootIndex - 1] : undefined
    return { index: previousRootId ? this.getVisibleSubtreeEnd(previousRootId) : 0, depth: 0, rootId: id }
  }

  private removeVisibleSubtree(id: string): boolean {
    const startIndex = this.visibleIndexById.get(id)
    if (startIndex === undefined) return false

    const depth = this._visibleRows[startIndex].depth
    let endIndex = startIndex + 1
    while (endIndex < this._visibleRows.length && this._visibleRows[endIndex].depth > depth) endIndex++
    const removed = this._visibleRows.splice(startIndex, endIndex - startIndex)
    for (const row of removed) this.visibleIndexById.delete(row.id)
    this.reindexVisibleRows(startIndex)
    return removed.length > 0
  }

  private getVisibleSubtreeEnd(id: string): number {
    const startIndex = this.visibleIndexById.get(id)
    if (startIndex === undefined) return this._visibleRows.length
    const depth = this._visibleRows[startIndex].depth
    let endIndex = startIndex + 1
    while (endIndex < this._visibleRows.length && this._visibleRows[endIndex].depth > depth) endIndex++
    return endIndex
  }

  private findSortedIndex(ids: string[], id: string): number {
    let low = 0
    let high = ids.length - 1
    while (low <= high) {
      const middle = (low + high) >>> 1
      const comparison = this.compareNodeIds(ids[middle], id)
      if (comparison < 0) low = middle + 1
      else if (comparison > 0) high = middle - 1
      else return middle
    }
    return -1
  }

  private insertVisibleRows(index: number, rows: TraceVisibleRow[]): void {
    const chunkSize = 10_000
    for (let offset = 0; offset < rows.length; offset += chunkSize) {
      this._visibleRows.splice(index + offset, 0, ...rows.slice(offset, offset + chunkSize))
    }
  }

  private reindexVisibleRows(startIndex: number): void {
    for (let index = startIndex; index < this._visibleRows.length; index++) {
      this.visibleIndexById.set(this._visibleRows[index].id, index)
    }
  }

  private rebuildVisibleRows(): void {
    this._visibleRows = this.flattenForest()
    this.visibleIndexById.clear()
    this.reindexVisibleRows(0)
  }

  private recordMutation(
    kind: MutationKind,
    structureChanged: boolean,
    previousVisibleCount: number
  ): TraceTreeMutation {
    if (structureChanged) {
      this._virtualItemKey = (index: number): string | number => this._visibleRows[index]?.id ?? index
    }
    this._lastMutation = {
      kind,
      revision: this._lastMutation.revision + 1,
      structureChanged,
      previousVisibleCount,
      visibleCount: this._visibleRows.length
    }
    return this._lastMutation
  }
}
