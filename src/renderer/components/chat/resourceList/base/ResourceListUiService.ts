import type { ResourceListItemBase, ResourceListViewGroup } from './ResourceListContext'

export type ResourceListRevealFocus = { itemId: string; requestId: number } | null

export type ResourceListRowStateSnapshot = {
  active: boolean
  dragging: boolean
  renaming: boolean
  revealFocused: boolean
  selected: boolean
}

export type ResourceListGroupStateSnapshot = {
  canCollapseToDefault: boolean
  collapsed: boolean
  hasMore: boolean
  selected: boolean
  visibleCount: number
}

type ResourceListUiStoreState = {
  activeId: string | null
  draggingId: string | null
  renamingId: string | null
  revealFocus: ResourceListRevealFocus
  selectedId: string | null
}

export type ResourceListListboxStateSnapshot = Pick<ResourceListUiStoreState, 'activeId' | 'selectedId'>

type ResourceListGroupRecord = Omit<ResourceListGroupStateSnapshot, 'selected'> & {
  itemIds: Set<string>
}

const EMPTY_ROW_STATE: ResourceListRowStateSnapshot = Object.freeze({
  active: false,
  dragging: false,
  renaming: false,
  revealFocused: false,
  selected: false
})

const EMPTY_GROUP_STATE: ResourceListGroupStateSnapshot = Object.freeze({
  canCollapseToDefault: false,
  collapsed: false,
  hasMore: false,
  selected: false,
  visibleCount: 0
})

function sameRowState(a: ResourceListRowStateSnapshot, b: ResourceListRowStateSnapshot) {
  return (
    a.active === b.active &&
    a.dragging === b.dragging &&
    a.renaming === b.renaming &&
    a.revealFocused === b.revealFocused &&
    a.selected === b.selected
  )
}

function sameGroupState(a: ResourceListGroupStateSnapshot, b: ResourceListGroupStateSnapshot) {
  return (
    a.canCollapseToDefault === b.canCollapseToDefault &&
    a.collapsed === b.collapsed &&
    a.hasMore === b.hasMore &&
    a.selected === b.selected &&
    a.visibleCount === b.visibleCount
  )
}

function addDefined(target: Set<string>, ...ids: Array<string | null | undefined>) {
  for (const id of ids) {
    if (id) target.add(id)
  }
}

export class ResourceListUiService {
  private groupCache = new Map<string, ResourceListGroupStateSnapshot>()
  private groupListeners = new Map<string, Set<() => void>>()
  private groupRecords = new Map<string, ResourceListGroupRecord>()
  private itemGroupIds = new Map<string, string>()
  private listboxListeners = new Set<() => void>()
  private listboxSnapshot: ResourceListListboxStateSnapshot
  private rowCache = new Map<string, ResourceListRowStateSnapshot>()
  private rowListeners = new Map<string, Set<() => void>>()
  private state: ResourceListUiStoreState

  constructor(initialState: Partial<ResourceListUiStoreState> = {}) {
    this.state = {
      activeId: initialState.activeId ?? null,
      draggingId: initialState.draggingId ?? null,
      renamingId: initialState.renamingId ?? null,
      revealFocus: initialState.revealFocus ?? null,
      selectedId: initialState.selectedId ?? null
    }
    this.listboxSnapshot = { activeId: this.state.activeId, selectedId: this.state.selectedId }
  }

  getRowSnapshot = (itemId: string): ResourceListRowStateSnapshot => {
    const next: ResourceListRowStateSnapshot = {
      active: this.state.activeId === itemId,
      dragging: this.state.draggingId === itemId,
      renaming: this.state.renamingId === itemId,
      revealFocused: this.state.revealFocus?.itemId === itemId,
      selected: this.state.selectedId === itemId
    }

    const previous = this.rowCache.get(itemId)
    if (previous && sameRowState(previous, next)) return previous
    if (sameRowState(EMPTY_ROW_STATE, next)) {
      this.rowCache.set(itemId, EMPTY_ROW_STATE)
      return EMPTY_ROW_STATE
    }

    this.rowCache.set(itemId, next)
    return next
  }

  getGroupSnapshot = (groupId: string): ResourceListGroupStateSnapshot => {
    const record = this.groupRecords.get(groupId)
    if (!record) return EMPTY_GROUP_STATE

    const next: ResourceListGroupStateSnapshot = {
      canCollapseToDefault: record.canCollapseToDefault,
      collapsed: record.collapsed,
      hasMore: record.hasMore,
      selected: this.state.selectedId !== null && record.itemIds.has(this.state.selectedId),
      visibleCount: record.visibleCount
    }
    const previous = this.groupCache.get(groupId)
    if (previous && sameGroupState(previous, next)) return previous

    this.groupCache.set(groupId, next)
    return next
  }

  getUiSnapshot = () => this.state

  getListboxSnapshot = (): ResourceListListboxStateSnapshot => {
    const { activeId, selectedId } = this.state
    if (this.listboxSnapshot.activeId === activeId && this.listboxSnapshot.selectedId === selectedId) {
      return this.listboxSnapshot
    }
    this.listboxSnapshot = { activeId, selectedId }
    return this.listboxSnapshot
  }

  setActiveId = (activeId: string | null) => {
    if (this.state.activeId === activeId) return
    const previousId = this.state.activeId
    this.state = { ...this.state, activeId }
    this.notifyRows(previousId, activeId)
    this.notifyListbox()
  }

  subscribeListbox = (listener: () => void) => {
    this.listboxListeners.add(listener)
    return () => {
      this.listboxListeners.delete(listener)
    }
  }

  subscribeRow = (itemId: string, listener: () => void) => {
    const listeners = this.rowListeners.get(itemId) ?? new Set<() => void>()
    listeners.add(listener)
    this.rowListeners.set(itemId, listeners)

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.rowListeners.delete(itemId)
        this.rowCache.delete(itemId)
      }
    }
  }

  subscribeGroup = (groupId: string, listener: () => void) => {
    const listeners = this.groupListeners.get(groupId) ?? new Set<() => void>()
    listeners.add(listener)
    this.groupListeners.set(groupId, listeners)

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.groupListeners.delete(groupId)
        this.groupCache.delete(groupId)
      }
    }
  }

  setDraggingId = (draggingId: string | null) => {
    if (this.state.draggingId === draggingId) return
    const previousId = this.state.draggingId
    this.state = { ...this.state, draggingId }
    this.notifyRows(previousId, draggingId)
  }

  setRenamingId = (renamingId: string | null) => {
    if (this.state.renamingId === renamingId) return
    const previousId = this.state.renamingId
    this.state = { ...this.state, renamingId }
    this.notifyRows(previousId, renamingId)
  }

  setRevealFocus = (revealFocus: ResourceListRevealFocus) => {
    const previousFocus = this.state.revealFocus
    if (previousFocus?.itemId === revealFocus?.itemId && previousFocus?.requestId === revealFocus?.requestId) return

    this.state = { ...this.state, revealFocus }
    this.notifyRows(previousFocus?.itemId, revealFocus?.itemId)
  }

  setSelectedId = (selectedId: string | null) => {
    if (this.state.selectedId === selectedId) return

    const previousId = this.state.selectedId
    const previousGroupId = previousId ? this.itemGroupIds.get(previousId) : undefined
    const nextGroupId = selectedId ? this.itemGroupIds.get(selectedId) : undefined

    this.state = { ...this.state, selectedId }
    this.notifyRows(previousId, selectedId)
    this.notifyGroups(previousGroupId, nextGroupId)
    this.notifyListbox()
  }

  setViewGroups<T extends ResourceListItemBase>(
    groups: readonly ResourceListViewGroup<T>[],
    getItemId: (item: T) => string
  ) {
    const nextGroupRecords = new Map<string, ResourceListGroupRecord>()
    const nextItemGroupIds = new Map<string, string>()
    const changedGroupIds = new Set<string>()

    for (const viewGroup of groups) {
      const itemIds = new Set<string>()
      for (const item of viewGroup.allItems) {
        const itemId = getItemId(item)
        itemIds.add(itemId)
        nextItemGroupIds.set(itemId, viewGroup.group.id)
      }

      const nextRecord: ResourceListGroupRecord = {
        canCollapseToDefault: viewGroup.canCollapseToDefault,
        collapsed: viewGroup.collapsed,
        hasMore: viewGroup.hasMore,
        itemIds,
        visibleCount: viewGroup.visibleCount
      }
      const previousSnapshot = this.getGroupSnapshot(viewGroup.group.id)
      nextGroupRecords.set(viewGroup.group.id, nextRecord)
      this.groupRecords.set(viewGroup.group.id, nextRecord)
      this.groupCache.delete(viewGroup.group.id)
      const nextSnapshot = this.getGroupSnapshot(viewGroup.group.id)
      if (!sameGroupState(previousSnapshot, nextSnapshot)) {
        changedGroupIds.add(viewGroup.group.id)
      }
    }

    for (const groupId of this.groupRecords.keys()) {
      if (!nextGroupRecords.has(groupId)) {
        changedGroupIds.add(groupId)
        this.groupCache.delete(groupId)
      }
    }

    this.groupRecords = nextGroupRecords
    this.itemGroupIds = nextItemGroupIds
    this.notifyGroups(...changedGroupIds)
  }

  private notifyGroups(...groupIds: Array<string | null | undefined>) {
    const next = new Set<string>()
    addDefined(next, ...groupIds)

    for (const groupId of next) {
      this.groupListeners.get(groupId)?.forEach((listener) => listener())
    }
  }

  private notifyRows(...itemIds: Array<string | null | undefined>) {
    const next = new Set<string>()
    addDefined(next, ...itemIds)

    for (const itemId of next) {
      this.rowCache.delete(itemId)
      this.rowListeners.get(itemId)?.forEach((listener) => listener())
    }
  }

  private notifyListbox() {
    if (this.listboxListeners.size === 0) return
    this.getListboxSnapshot()
    this.listboxListeners.forEach((listener) => listener())
  }
}
