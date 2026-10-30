import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, DialogFooter } from '@cherrystudio/ui'
import { FeishuApplicationPicker } from '@renderer/components/credentials/FeishuApplicationPicker'
import { ipcApi } from '@renderer/ipc'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { knowledgeErrorCodes } from '@shared/ipc/errors/knowledge'
import type { InputFor, OutputFor } from '@shared/ipc/types'

import FeishuAuthorizationStatus from './FeishuAuthorizationStatus'

interface FeishuConnectionFormProps {
  onConnected: (connectionId: string, scopeMode: 'space' | 'url') => void
  onCancel: () => void
  onBusyChange?: (busy: boolean) => void
  disabled?: boolean
  children?: ReactNode
}

const FeishuConnectionForm = ({
  onConnected,
  onCancel,
  onBusyChange,
  disabled,
  children
}: FeishuConnectionFormProps) => {
  const { t } = useTranslation()
  const [applicationId, setApplicationId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canConnectWithLink, setCanConnectWithLink] = useState(false)
  const [linkOnly, setLinkOnly] = useState(false)
  const [authorization, setAuthorization] = useState<OutputFor<'knowledge.feishu.authorization.begin'> | null>(null)
  const registeredApplicationId = useRef<string | null>(null)
  const registrationSessionId = useRef<string | null>(null)
  const authorizationSessionId = useRef<string | null>(null)
  const authorizationAttempt = useRef(0)
  const onBusyChangeRef = useRef(onBusyChange)
  const unavailable = busy || disabled

  const cancelPending = () => {
    if (registrationSessionId.current) {
      void ipcApi
        .request('feishu.registration.cancel', { registrationSessionId: registrationSessionId.current })
        .catch(() => {})
      registrationSessionId.current = null
    }
    if (authorizationSessionId.current) {
      void ipcApi
        .request('knowledge.feishu.authorization.cancel', { authorizationSessionId: authorizationSessionId.current })
        .catch(() => {})
      authorizationSessionId.current = null
    }
  }
  useEffect(() => {
    onBusyChangeRef.current = onBusyChange
  }, [onBusyChange])
  useEffect(
    () => () => {
      authorizationAttempt.current += 1
      cancelPending()
      setBusy(false)
      setAuthorization(null)
      onBusyChangeRef.current?.(false)
    },
    []
  )

  const cancel = () => {
    authorizationAttempt.current += 1
    cancelPending()
    onBusyChange?.(false)
    setBusy(false)
    setAuthorization(null)
    onCancel()
  }

  const connect = async (input: InputFor<'knowledge.feishu.authorization.begin'>, useLinkOnly = linkOnly) => {
    if (unavailable) return
    const attempt = ++authorizationAttempt.current
    const isCurrent = () => authorizationAttempt.current === attempt
    setBusy(true)
    onBusyChange?.(true)
    setError(null)
    setCanConnectWithLink(false)
    let started: OutputFor<'knowledge.feishu.authorization.begin'> | undefined
    try {
      started = await ipcApi.request('knowledge.feishu.authorization.begin', input)
      if (!isCurrent()) {
        void ipcApi
          .request('knowledge.feishu.authorization.cancel', { authorizationSessionId: started.authorizationSessionId })
          .catch(() => {})
        return
      }
      authorizationSessionId.current = started.authorizationSessionId
      setAuthorization(started)
      const connected = await ipcApi.request('knowledge.feishu.authorization.complete', {
        authorizationSessionId: started.authorizationSessionId
      })
      if (!isCurrent()) return
      authorizationSessionId.current = null
      onConnected(connected.id, useLinkOnly ? 'url' : 'space')
    } catch (cause) {
      if (isCurrent()) {
        const code = cause instanceof IpcError ? cause.code : null
        setError(
          t(
            code === knowledgeErrorCodes.FEISHU_IDENTITY_UNVERIFIABLE
              ? 'knowledge.external.wizard.identity_error'
              : code === knowledgeErrorCodes.FEISHU_SCOPE_MISSING
                ? 'knowledge.external.wizard.scope_error'
                : 'knowledge.external.wizard.authorization_error'
          )
        )
        setCanConnectWithLink(!started && !useLinkOnly && code === knowledgeErrorCodes.FEISHU_SCOPE_MISSING)
      }
    } finally {
      if (isCurrent()) {
        cancelPending()
        setBusy(false)
        onBusyChange?.(false)
        setAuthorization(null)
      }
    }
  }

  const connectSaved = (useLinkOnly = linkOnly) => {
    const id = applicationId ?? registeredApplicationId.current
    if (id)
      void connect(
        { kind: 'saved-application', applicationCredentialId: id, includeSpaceDiscovery: !useLinkOnly },
        useLinkOnly
      )
  }

  return (
    <form
      className="flex min-h-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        connectSaved()
      }}>
      {authorization ? (
        <FeishuAuthorizationStatus
          userCode={authorization.userCode}
          verificationUri={authorization.verificationUri}
          onCancel={cancel}
        />
      ) : (
        <>
          <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
            {children}
            <fieldset disabled={unavailable} className="min-w-0">
              <FeishuApplicationPicker
                value={applicationId}
                purpose="knowledge"
                onChange={(id) => {
                  setApplicationId(id)
                  registeredApplicationId.current = null
                  setLinkOnly(false)
                  setCanConnectWithLink(false)
                  setError(null)
                }}
                onRegistered={(app, sessionId) => {
                  registrationSessionId.current = sessionId
                  registeredApplicationId.current = app.id
                  return connect({ kind: 'personal-agent', registrationSessionId: sessionId }, false)
                }}
              />
            </fieldset>
            {busy && <p role="status">{t('knowledge.external.wizard.connecting')}</p>}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {canConnectWithLink && (
              <Button
                type="button"
                variant="outline"
                disabled={unavailable}
                onClick={() => {
                  setLinkOnly(true)
                  connectSaved(true)
                }}>
                {t('knowledge.external.wizard.connect_with_link')}
              </Button>
            )}
          </div>
          <DialogFooter className="shrink-0">
            <Button type="button" variant="outline" onClick={cancel}>
              {t('common.cancel')}
            </Button>
            {applicationId && (
              <Button type="submit" loading={busy} disabled={unavailable}>
                {t('knowledge.external.wizard.connect')}
              </Button>
            )}
          </DialogFooter>
        </>
      )}
    </form>
  )
}
export default FeishuConnectionForm
