import { useCallback, useEffect, useRef, useState } from 'react'

import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { ComputerUseControl } from '@shared/ipc/schemas/computerUse'

export function useAgentDesktopControls() {
  const [controls, setControls] = useState<ComputerUseControl[]>()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const pendingRef = useRef(new Map<string, 'inflight' | 'settled'>())
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const generation = useRef(0)
  const mounted = useRef(false)

  const publishPending = useCallback(() => setPending(new Set(pendingRef.current.keys())), [])
  const reconcilePending = useCallback(
    (snapshot: ComputerUseControl[], resumed: boolean) => {
      for (const [key, state] of pendingRef.current) {
        if (
          (resumed && state === 'settled') ||
          !snapshot.some(
            (row) =>
              JSON.stringify([row.ownerId, row.appId]) === key && (row.status === 'opening' || row.status === 'active')
          )
        ) {
          pendingRef.current.delete(key)
        }
      }
      publishPending()
    },
    [publishPending]
  )

  useIpcOn('computer_use.controls_changed', (snapshot) => {
    if (!mounted.current) return
    generation.current++
    setControls(snapshot)
    setLoading(false)
    setFailed(false)
    reconcilePending(snapshot, false)
  })

  useEffect(() => {
    mounted.current = true
    let alive = true
    const start = generation.current
    void ipcApi.request('computer_use.get_controls').then(
      (snapshot) => {
        if (!alive || generation.current !== start) return
        reconcilePending(snapshot, true)
        setControls(snapshot)
        setLoading(false)
      },
      () => {
        if (!alive || generation.current !== start) return
        setFailed(true)
        setLoading(false)
      }
    )
    return () => {
      alive = false
      mounted.current = false
    }
  }, [reconcilePending])

  // Rejects on command failure so the presentation can report it.
  const stopApp = useCallback(
    async (control: ComputerUseControl) => {
      const { ownerId, appId } = control
      if (!appId) return
      const key = JSON.stringify([ownerId, appId])
      if (pendingRef.current.has(key)) return
      pendingRef.current.set(key, 'inflight')
      if (mounted.current) publishPending()
      try {
        await ipcApi.request('computer_use.stop_app', { ownerId, appId })
        if (pendingRef.current.has(key)) pendingRef.current.set(key, 'settled')
      } catch (error) {
        pendingRef.current.delete(key)
        if (mounted.current) publishPending()
        throw error
      }
    },
    [publishPending]
  )

  return { controls, loading, failed, pending, stopApp }
}
