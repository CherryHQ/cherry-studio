import { type ComponentProps, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { RuntimeEffortControl } from '@cherrystudio/agent-runtime'
import type { PopoverContent } from '@cherrystudio/ui'
import { ReasoningEffortControl, type ReasoningEffortControlOption } from '@renderer/components/ModelSpeedControl'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { reasoningEffortLabel } from '@renderer/utils/reasoning'

export function LocalAgentThoughtControl({
  sessionId,
  selection,
  disabled,
  side = 'top'
}: {
  sessionId: string
  selection: RuntimeEffortControl
  disabled: boolean
  side?: ComponentProps<typeof PopoverContent>['side']
}) {
  const { t } = useTranslation()
  const selectionKey = JSON.stringify([sessionId, selection.id, selection.modelId])
  const [pending, setPending] = useState<{ selectionKey: string; value: string } | null>(null)
  const inFlightRef = useRef(false)
  const queuedValueRef = useRef<string | null>(null)
  const activeKeyRef = useRef(selectionKey)
  activeKeyRef.current = selectionKey
  const latestCurrentValueRef = useRef(selection.currentValue)
  latestCurrentValueRef.current = selection.currentValue

  useEffect(() => {
    queuedValueRef.current = null
    setPending(null)
  }, [selectionKey])

  useEffect(() => {
    if (!inFlightRef.current && queuedValueRef.current === null) {
      setPending((current) =>
        current?.selectionKey === selectionKey && current.value === selection.currentValue ? null : current
      )
    }
  }, [selection.currentValue, selectionKey])

  const options = useMemo<ReasoningEffortControlOption[]>(
    () =>
      selection.options.map((option) => ({
        value: option.value,
        label: reasoningEffortLabel(option.value, t, option.name),
        tier: option.value.trim().toLowerCase()
      })),
    [selection.options, t]
  )

  const currentValue = pending?.selectionKey === selectionKey ? pending.value : selection.currentValue

  const dispatchSelection = async (value: string) => {
    await ipcApi.request('ai.local_agents.set_thought_level', {
      sessionId,
      configId: selection.id,
      value,
      ...(selection.modelId ? { modelId: selection.modelId } : {})
    })
  }

  const handleChange = (nextValue: string) => {
    if (disabled || nextValue === currentValue) return
    setPending({ selectionKey, value: nextValue })
    queuedValueRef.current = nextValue
    if (inFlightRef.current) return

    inFlightRef.current = true
    const runKey = selectionKey
    void (async () => {
      try {
        let lastTarget: string | null = null
        while (queuedValueRef.current !== null && activeKeyRef.current === runKey) {
          const targetValue = queuedValueRef.current
          queuedValueRef.current = null
          lastTarget = targetValue
          await dispatchSelection(targetValue)
        }
        if (
          lastTarget !== null &&
          activeKeyRef.current === runKey &&
          queuedValueRef.current === null &&
          latestCurrentValueRef.current === lastTarget
        ) {
          setPending((current) => (current?.selectionKey === runKey ? null : current))
        }
      } catch (error) {
        queuedValueRef.current = null
        if (activeKeyRef.current === runKey) {
          setPending((current) => (current?.selectionKey === runKey ? null : current))
        }
        toast.error(String(error))
      } finally {
        inFlightRef.current = false
      }
    })()
  }

  return (
    <ReasoningEffortControl
      options={options}
      currentValue={currentValue}
      disabled={disabled}
      readOnlyNotice={t('local_agents.configuration_read_only')}
      side={side}
      onChange={handleChange}
    />
  )
}
