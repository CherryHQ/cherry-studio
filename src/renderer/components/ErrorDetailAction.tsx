import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { openLoadedErrorDetail, showDetailOpenFailed } from '@renderer/services/appErrorDetailOpen'
import type { AppErrorDetailRequest, InlineErrorDetailInput } from '@renderer/services/AppErrorDetailService'

interface DetailLoad {
  readonly input: InlineErrorDetailInput
  readonly pending: Promise<AppErrorDetailRequest>
}

function sameDetailInput(left: InlineErrorDetailInput, right: InlineErrorDetailInput): boolean {
  return (
    left.error === right.error &&
    left.source === right.source &&
    left.operation === right.operation &&
    left.message === right.message &&
    left.providerId === right.providerId &&
    left.modelId === right.modelId &&
    left.recordId === right.recordId &&
    left.imageOnly === right.imageOnly &&
    left.params === right.params &&
    left.allowParams === right.allowParams
  )
}

/** One builder call per fault, shared by the preload effect and a click that wins the race. */
function loadFaultRequest(
  snapshot: InlineErrorDetailInput,
  inputRef: { readonly current: InlineErrorDetailInput },
  requestRef: { current: AppErrorDetailRequest | undefined },
  loadRef: { current: DetailLoad | undefined }
): Promise<AppErrorDetailRequest> {
  const current = loadRef.current
  if (current && sameDetailInput(current.input, snapshot)) return current.pending

  const pending = import('@renderer/services/AppErrorDetailService').then(({ buildInlineErrorDetailRequest }) => {
    const request = buildInlineErrorDetailRequest(snapshot)
    if (loadRef.current?.pending === pending && sameDetailInput(snapshot, inputRef.current)) {
      requestRef.current = request
    }
    return request
  })
  void pending.catch(() => {
    if (loadRef.current?.pending === pending) {
      loadRef.current = undefined
      requestRef.current = undefined
    }
  })
  if (sameDetailInput(snapshot, inputRef.current)) {
    loadRef.current = { input: snapshot, pending }
  }
  return pending
}

export function ErrorDetailAction(props: InlineErrorDetailInput) {
  const { t } = useTranslation()
  const requestRef = useRef<AppErrorDetailRequest | undefined>(undefined)
  const loadRef = useRef<DetailLoad | undefined>(undefined)
  const propsRef = useRef(props)
  const inputRef = useRef(props)
  propsRef.current = props
  if (!sameDetailInput(inputRef.current, props)) {
    inputRef.current = props
    requestRef.current = undefined
    loadRef.current = undefined
  }

  useEffect(() => {
    let cancelled = false
    const snapshot = propsRef.current
    void loadFaultRequest(snapshot, inputRef, requestRef, loadRef).catch(() => {
      if (!cancelled && sameDetailInput(snapshot, inputRef.current)) requestRef.current = undefined
    })
    return () => {
      cancelled = true
    }
  }, [
    props.allowParams,
    props.error,
    props.imageOnly,
    props.message,
    props.modelId,
    props.operation,
    props.params,
    props.providerId,
    props.recordId,
    props.source
  ])

  const openCurrent = () => {
    const ready = requestRef.current
    if (ready) {
      openLoadedErrorDetail(ready)
      return
    }
    const snapshot = propsRef.current
    const openSnapshot = () => {
      void loadFaultRequest(snapshot, inputRef, requestRef, loadRef)
        .then((request) => openLoadedErrorDetail(request))
        .catch(() => showDetailOpenFailed(openSnapshot))
    }
    openSnapshot()
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={openCurrent}>
      {t('error.details')}
    </Button>
  )
}
