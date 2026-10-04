import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, DialogFooter, Field, FieldLabel, Input, NormalTooltip } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { knowledgeErrorCodes } from '@shared/ipc/errors/knowledge'
import type { OutputFor } from '@shared/ipc/types'

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
  const id = useId()
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canConnectWithLink, setCanConnectWithLink] = useState(false)
  const [linkOnly, setLinkOnly] = useState(false)
  const [registrationUri, setRegistrationUri] = useState<string | null>(null)
  const [authorization, setAuthorization] = useState<OutputFor<'knowledge.feishu.authorization.begin'> | null>(null)
  const registrationSessionId = useRef<string | null>(null)
  const authorizationSessionId = useRef<string | null>(null)
  const closed = useRef(false)
  const unavailable = busy || disabled

  const cancelPending = () => {
    if (registrationSessionId.current) {
      void ipcApi.request('knowledge.feishu.registration.cancel', {
        registrationSessionId: registrationSessionId.current
      })
      registrationSessionId.current = null
    }
    if (authorizationSessionId.current) {
      void ipcApi.request('knowledge.feishu.authorization.cancel', {
        authorizationSessionId: authorizationSessionId.current
      })
      authorizationSessionId.current = null
    }
  }

  useEffect(() => {
    closed.current = false
    return () => {
      closed.current = true
      cancelPending()
      onBusyChange?.(false)
    }
  }, [onBusyChange])

  const cancel = () => {
    closed.current = true
    cancelPending()
    setRegistrationUri(null)
    setAuthorization(null)
    setAppSecret('')
    onCancel()
  }

  const finishAuthorization = async (
    started: OutputFor<'knowledge.feishu.authorization.begin'>,
    scopeMode: 'space' | 'url'
  ) => {
    authorizationSessionId.current = started.authorizationSessionId
    if (closed.current) {
      cancelPending()
      return
    }
    setRegistrationUri(null)
    setAuthorization(started)
    await window.api.shell.openExternal(started.verificationUri)
    if (closed.current) return
    const connected = await ipcApi.request('knowledge.feishu.authorization.complete', {
      authorizationSessionId: started.authorizationSessionId
    })
    authorizationSessionId.current = null
    if (closed.current) return
    setAuthorization(null)
    setAppSecret('')
    onConnected(connected.id, scopeMode)
  }

  const connect = async (automatic = false, useLinkOnly = linkOnly) => {
    if (unavailable) return
    setBusy(true)
    onBusyChange?.(true)
    setError(null)
    setCanConnectWithLink(false)
    let started: OutputFor<'knowledge.feishu.authorization.begin'> | undefined
    try {
      if (automatic) {
        const registration = await ipcApi.request('knowledge.feishu.registration.begin')
        registrationSessionId.current = registration.registrationSessionId
        if (closed.current) {
          cancelPending()
          return
        }
        setRegistrationUri(registration.verificationUri)
        await window.api.shell.openExternal(registration.verificationUri)
        if (closed.current) return
        started = await ipcApi.request('knowledge.feishu.authorization.begin', {
          kind: 'personal-agent',
          registrationSessionId: registration.registrationSessionId
        })
        registrationSessionId.current = null
      } else {
        started = await ipcApi.request('knowledge.feishu.authorization.begin', {
          kind: 'custom-app',
          appId: appId.trim(),
          appSecret,
          includeSpaceDiscovery: !useLinkOnly
        })
      }
      await finishAuthorization(started, useLinkOnly ? 'url' : 'space')
    } catch (cause) {
      if (!closed.current) {
        const code = cause instanceof IpcError ? cause.code : null
        setError(
          t(
            code === knowledgeErrorCodes.FEISHU_IDENTITY_UNVERIFIABLE
              ? 'knowledge.external.wizard.identity_error'
              : code === knowledgeErrorCodes.FEISHU_SCOPE_MISSING
                ? 'knowledge.external.wizard.scope_error'
                : code === knowledgeErrorCodes.FEISHU_REGISTRATION_FAILED
                  ? 'knowledge.external.wizard.registration_error'
                  : 'knowledge.external.wizard.authorization_error'
          )
        )
        setCanConnectWithLink(
          !automatic && !started && !useLinkOnly && code === knowledgeErrorCodes.FEISHU_SCOPE_MISSING
        )
      }
    } finally {
      cancelPending()
      onBusyChange?.(false)
      if (!closed.current) {
        setBusy(false)
        setRegistrationUri(null)
        setAuthorization(null)
      }
    }
  }

  return (
    <form
      className="flex min-h-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (appId.trim() && appSecret) void connect()
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
            <div className="flex items-start gap-1">
              <p className="text-muted-foreground text-sm">{t('knowledge.external.wizard.app_help')}</p>
              <NormalTooltip
                content={t('knowledge.external.wizard.create_app')}
                contentProps={{ portalContainer: document.body }}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={unavailable}
                  aria-label={t('knowledge.external.wizard.create_app')}
                  className="text-muted-foreground size-6 shrink-0"
                  onClick={() => {
                    setLinkOnly(false)
                    void connect(true, false)
                  }}>
                  <Plus className="size-3.5" />
                </Button>
              </NormalTooltip>
            </div>
            <Field>
              <FieldLabel htmlFor={`${id}-app-id`}>{t('knowledge.external.wizard.custom_app_id')}</FieldLabel>
              <Input
                id={`${id}-app-id`}
                disabled={unavailable}
                value={appId}
                onChange={(event) => {
                  setAppId(event.target.value)
                  setLinkOnly(false)
                  setCanConnectWithLink(false)
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-app-secret`}>{t('knowledge.external.wizard.custom_app_secret')}</FieldLabel>
              <Input
                id={`${id}-app-secret`}
                disabled={unavailable}
                type="password"
                autoComplete="new-password"
                value={appSecret}
                onChange={(event) => {
                  setAppSecret(event.target.value)
                  setLinkOnly(false)
                  setCanConnectWithLink(false)
                }}
              />
            </Field>
            {registrationUri ? (
              <div role="status" className="space-y-2 text-sm">
                <p>{t('knowledge.external.wizard.registration_wait')}</p>
                <p>{t('knowledge.external.wizard.registration_help')}</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void window.api.shell.openExternal(registrationUri)}>
                  {t('knowledge.external.wizard.open_feishu')}
                </Button>
              </div>
            ) : null}
            {busy && !registrationUri ? <p role="status">{t('knowledge.external.wizard.connecting')}</p> : null}
            {error ? (
              <p role="alert" className="text-error-subtle-foreground text-sm">
                {error}
              </p>
            ) : null}
            {canConnectWithLink ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={unavailable}
                onClick={() => {
                  setLinkOnly(true)
                  void connect(false, true)
                }}>
                {t('knowledge.external.wizard.connect_with_link')}
              </Button>
            ) : null}
          </div>
          <DialogFooter className="shrink-0">
            <Button type="button" variant="outline" onClick={cancel}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={busy} disabled={unavailable || !appId.trim() || !appSecret}>
              {t('knowledge.external.wizard.connect')}
            </Button>
          </DialogFooter>
        </>
      )}
    </form>
  )
}

export default FeishuConnectionForm
