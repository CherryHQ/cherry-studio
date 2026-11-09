import { useCallback, useEffect, useRef, useState } from 'react'

import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { ComputerUseControl } from '@shared/ipc/schemas/computerUse'

export function useAgentDesktopControls() {
  const [controls, setControls] = useState<ComputerUseControl[]>()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const pendingRef = useRef(new Set<string>())
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const generation = useRef(0)
  const mounted = useRef(false)

  useIpcOn('computer_use.controls_changed', (snapshot) => {
    if (!mounted.current) return
    generation.current++
    setControls(snapshot)
    setLoading(false)
    setFailed(false)
    for (const key of pendingRef.current) {
      if (
        !snapshot.some(
          (row) =>
            JSON.stringify([row.ownerId, row.appId]) === key && (row.status === 'opening' || row.status === 'active')
        )
      ) {
        pendingRef.current.delete(key)
      }
    }
    setPending(new Set(pendingRef.current))
  })

  useEffect(() => {
    mounted.current = true
    let alive = true
    const start = generation.current
    void ipcApi.request('computer_use.get_controls').then(
      (snapshot) => {
        if (!alive || generation.current !== start) return
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
  }, [])

  // Rejects on command failure so the presentation can report it.
  const stopApp = useCallback(async (control: ComputerUseControl) => {
    const { ownerId, appId } = control
    if (!appId) return
    const key = JSON.stringify([ownerId, appId])
    if (pendingRef.current.has(key)) return
    pendingRef.current.add(key)
    setPending(new Set(pendingRef.current))
    try {
      await ipcApi.request('computer_use.stop_app', { ownerId, appId })
    } catch (error) {
      pendingRef.current.delete(key)
      if (mounted.current) setPending(new Set(pendingRef.current))
      throw error
    }
  }, [])

  return { controls, loading, failed, pending, stopApp }
}
