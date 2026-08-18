import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'

import type { ResourceListItemBase } from './ResourceListContext'

export type ResourceListRemoteGroupSnapshot<T extends ResourceListItemBase> = {
  error?: Error
  groupId: string
  hasNext: boolean
  isLoading: boolean
  isRefreshing: boolean
  items: readonly T[]
  loadNext: () => void
  queryKey: string
  retry: () => void
}

type ResourceListRemoteGroupRegistration = symbol

type ResourceListRemoteGroupRecord<T extends ResourceListItemBase> = {
  registration: ResourceListRemoteGroupRegistration
  snapshot: ResourceListRemoteGroupSnapshot<T>
}

const EMPTY_REMOTE_GROUP_SNAPSHOTS: readonly ResourceListRemoteGroupSnapshot<ResourceListItemBase>[] = Object.freeze([])

/** Coordinates independently mounted remote group queries without owning their cursor state. */
export class ResourceListRemoteGroupService<T extends ResourceListItemBase> {
  private listeners = new Set<() => void>()
  private records = new Map<string, ResourceListRemoteGroupRecord<T>>()
  private snapshot = EMPTY_REMOTE_GROUP_SNAPSHOTS as readonly ResourceListRemoteGroupSnapshot<T>[]

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  register(groupId: string): ResourceListRemoteGroupRegistration {
    return Symbol(groupId)
  }

  update(registration: ResourceListRemoteGroupRegistration, snapshot: ResourceListRemoteGroupSnapshot<T>) {
    const current = this.records.get(snapshot.groupId)
    if (current?.registration === registration && current.snapshot === snapshot) return

    this.records.set(snapshot.groupId, { registration, snapshot })
    this.publish()
  }

  unregister(groupId: string, registration: ResourceListRemoteGroupRegistration) {
    if (this.records.get(groupId)?.registration !== registration) return
    this.records.delete(groupId)
    this.publish()
  }

  loadNext(groupId: string) {
    const group = this.records.get(groupId)?.snapshot
    if (!group) return false
    if (!group.error && !group.isLoading && !group.isRefreshing && group.hasNext) group.loadNext()
    return true
  }

  retry(groupId: string) {
    const group = this.records.get(groupId)?.snapshot
    if (!group) return false
    if (group.error && !group.isLoading && !group.isRefreshing) group.retry()
    return true
  }

  refresh() {
    for (const { snapshot } of this.records.values()) {
      if (!snapshot.isLoading && !snapshot.isRefreshing) snapshot.retry()
    }
  }

  private publish() {
    this.snapshot = [...this.records.values()].map((record) => record.snapshot)
    for (const listener of this.listeners) listener()
  }
}

export function useResourceListRemoteGroupService<T extends ResourceListItemBase>() {
  const serviceRef = useRef<ResourceListRemoteGroupService<T> | null>(null)
  if (!serviceRef.current) serviceRef.current = new ResourceListRemoteGroupService<T>()
  return serviceRef.current
}

export function useResourceListRemoteGroupSnapshots<T extends ResourceListItemBase>(
  service?: ResourceListRemoteGroupService<T>
): readonly ResourceListRemoteGroupSnapshot<T>[] {
  const emptyGetSnapshot = getEmptyRemoteGroupSnapshots as () => readonly ResourceListRemoteGroupSnapshot<T>[]
  return useSyncExternalStore<readonly ResourceListRemoteGroupSnapshot<T>[]>(
    service?.subscribe ?? emptySubscribe,
    service?.getSnapshot ?? emptyGetSnapshot,
    service?.getSnapshot ?? emptyGetSnapshot
  )
}

export function useRegisterResourceListRemoteGroup<T extends ResourceListItemBase>(
  service: ResourceListRemoteGroupService<T>,
  snapshot: ResourceListRemoteGroupSnapshot<T>
) {
  const registrationRef = useRef<ResourceListRemoteGroupRegistration | null>(null)
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  useLayoutEffect(() => {
    const registration = service.register(snapshot.groupId)
    registrationRef.current = registration
    service.update(registration, snapshotRef.current)

    return () => {
      registrationRef.current = null
      service.unregister(snapshot.groupId, registration)
    }
  }, [service, snapshot.groupId])

  useLayoutEffect(() => {
    const registration = registrationRef.current
    if (registration) service.update(registration, snapshot)
  }, [service, snapshot])
}

function emptySubscribe() {
  return () => undefined
}

function getEmptyRemoteGroupSnapshots<T extends ResourceListItemBase>() {
  return EMPTY_REMOTE_GROUP_SNAPSHOTS as readonly ResourceListRemoteGroupSnapshot<T>[]
}
