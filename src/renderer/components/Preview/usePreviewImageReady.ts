import { useCallback, useMemo, useState } from 'react'

/** A late or not-yet-mounted preview must never enable another source's image action. */
export function usePreviewImageReady(previewKey: string, requiresReadySignal: boolean) {
  const identity = useMemo(() => ({ previewKey }), [previewKey])
  const [report, setReport] = useState<{ identity: object; ready: boolean }>()
  const onImageReadyChange = useCallback((ready: boolean) => setReport({ identity, ready }), [identity])
  const previewImageReady = report?.identity === identity ? report.ready : requiresReadySignal ? false : undefined
  return { previewImageReady, onImageReadyChange }
}
