import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Combobox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Label,
  SegmentedControl
} from '@cherrystudio/ui'
import { useInvalidateCache, useQuery } from '@data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type {
  ExternalKnowledgeDocumentKind,
  ExternalKnowledgeScopePreview,
  FeishuWikiSpace,
  FeishuWikiSpacePreview
} from '@shared/data/types/externalKnowledgeRead'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { knowledgeErrorCodes } from '@shared/ipc/errors/knowledge'

import FeishuAuthorizationStatus from './FeishuAuthorizationStatus'
import FeishuConnectionForm from './FeishuConnectionForm'

interface FeishuWikiWizardProps {
  open: boolean
  baseId: string
  onOpenChange: (open: boolean) => void
}

type AuthorizationStart = {
  authorizationSessionId: string
  verificationUri: string
  userCode: string
}

type ScopePreview =
  | { kind: 'url'; data: ExternalKnowledgeScopePreview }
  | { kind: 'space'; data: FeishuWikiSpacePreview[] }

const documentTypeKeys = {
  document: 'knowledge.external.wizard.document_types.document',
  spreadsheet: 'knowledge.external.wizard.document_types.spreadsheet',
  database: 'knowledge.external.wizard.document_types.database',
  presentation: 'knowledge.external.wizard.document_types.presentation',
  file: 'knowledge.external.wizard.document_types.file',
  other: 'knowledge.external.wizard.document_types.other'
} satisfies Record<ExternalKnowledgeDocumentKind, string>

const FeishuWikiWizard = ({ open, baseId, onOpenChange }: FeishuWikiWizardProps) => {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const {
    data: connections,
    isLoading: isLoadingConnections,
    error: connectionsError,
    refetch
  } = useQuery('/external-knowledge-connections')
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const [scopeMode, setScopeMode] = useState<'space' | 'url'>('space')
  const [spaces, setSpaces] = useState<FeishuWikiSpace[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | undefined>()
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>([])
  const [spacesLoading, setSpacesLoading] = useState(false)
  const [spacesError, setSpacesError] = useState<'permission' | 'other' | null>(null)
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<ScopePreview | null>(null)
  const [createdCount, setCreatedCount] = useState(0)
  const [policy, setPolicy] = useState<'manual' | 'daily'>('daily')
  const [dailyTime, setDailyTime] = useState('09:00')
  const [authorization, setAuthorization] = useState<AuthorizationStart | null>(null)
  const [busy, setBusy] = useState(false)
  const [connectingNewApp, setConnectingNewApp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const authorizationSessionId = useRef<string | null>(null)
  const closed = useRef(false)
  const spacesRequestVersion = useRef(0)
  const loadedSpacesConnectionId = useRef<string | null>(null)
  const createdScopes = useRef(new Set<string>())
  const isCreating = busy && step === 3
  const reviewLocked = busy || createdCount > 0
  const previewEntries = preview
    ? preview.kind === 'space'
      ? preview.data.map((data) => ({ key: data.space.spaceId, title: data.space.name, data }))
      : [{ key: 'url', title: preview.data.resolution.selected.title, data: preview.data }]
    : []
  const hasConnectedConnections =
    !connectionsError && connections?.some((connection) => connection.authorizationStatus === 'connected')
  const showAppForm = connectingNewApp || !hasConnectedConnections
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  const selectConnection = (connectionId: string | null) => {
    setScopeMode('space')
    spacesRequestVersion.current += 1
    loadedSpacesConnectionId.current = null
    setSelectedConnectionId(connectionId)
    setSpaces([])
    setNextPageToken(undefined)
    setSelectedSpaceIds([])
    setSpacesLoading(false)
    setSpacesError(null)
    setPreview(null)
    setError(null)
  }

  const loadSpaces = useCallback(async (connectionId: string, pageToken?: string) => {
    const requestVersion = ++spacesRequestVersion.current
    setSpacesLoading(true)
    setSpacesError(null)
    try {
      const page = await ipcApi.request('knowledge.feishu.spaces.list', {
        connectionId,
        ...(pageToken && { pageToken })
      })
      if (closed.current || requestVersion !== spacesRequestVersion.current) return
      if (!pageToken) loadedSpacesConnectionId.current = connectionId
      setSpaces((current) => {
        const knownIds = new Set<string>()
        return [...(pageToken ? current : []), ...page.spaces].filter((space) => {
          if (knownIds.has(space.spaceId)) return false
          knownIds.add(space.spaceId)
          return true
        })
      })
      setNextPageToken(page.nextPageToken)
    } catch (cause) {
      if (closed.current || requestVersion !== spacesRequestVersion.current) return
      setSpacesError(
        cause instanceof IpcError && cause.code === knowledgeErrorCodes.FEISHU_SCOPE_MISSING ? 'permission' : 'other'
      )
    } finally {
      if (!closed.current && requestVersion === spacesRequestVersion.current) setSpacesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (step !== 2 || scopeMode !== 'space' || !selectedConnectionId) return
    if (loadedSpacesConnectionId.current === selectedConnectionId) return
    setSpaces([])
    setNextPageToken(undefined)
    void loadSpaces(selectedConnectionId)
    return () => {
      spacesRequestVersion.current += 1
    }
  }, [step, scopeMode, selectedConnectionId, loadSpaces])

  const cancelPendingAuthorization = () => {
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
      cancelPendingAuthorization()
    }
  }, [])

  const close = () => {
    closed.current = true
    spacesRequestVersion.current += 1
    cancelPendingAuthorization()
    setAuthorization(null)
    onOpenChange(false)
  }

  const formatAuthorizationError = (cause: unknown) => {
    if (cause instanceof IpcError) {
      switch (cause.code) {
        case knowledgeErrorCodes.FEISHU_IDENTITY_UNVERIFIABLE:
          return t('knowledge.external.wizard.identity_error')
        case knowledgeErrorCodes.FEISHU_SCOPE_MISSING:
          return t('knowledge.external.wizard.scope_error')
        case knowledgeErrorCodes.FEISHU_REGISTRATION_FAILED:
          return t('knowledge.external.wizard.registration_error')
      }
    }
    return t('knowledge.external.wizard.authorization_error')
  }

  const finishAuthorization = async (started: AuthorizationStart, initialScopeMode?: 'space' | 'url') => {
    authorizationSessionId.current = started.authorizationSessionId
    if (closed.current) {
      cancelPendingAuthorization()
      return
    }
    setAuthorization(started)
    await window.api.shell.openExternal(started.verificationUri)
    if (closed.current) return
    const connected = await ipcApi.request('knowledge.feishu.authorization.complete', {
      authorizationSessionId: started.authorizationSessionId
    })
    authorizationSessionId.current = null
    if (closed.current) return
    setAuthorization(null)
    selectConnection(connected.id)
    if (initialScopeMode) setScopeMode(initialScopeMode)
    setStep(2)
    void invalidate('/external-knowledge-connections')
    return connected.id
  }

  const reconnect = async (connectionId: string, includeSpaceDiscovery = false) => {
    setBusy(true)
    setError(null)
    try {
      const started = await ipcApi.request('knowledge.feishu.connection.reconnect', {
        connectionId,
        ...(includeSpaceDiscovery && { includeSpaceDiscovery: true })
      })
      const connectedId = await finishAuthorization(started)
      if (
        includeSpaceDiscovery &&
        connectedId &&
        connectedId === selectedConnectionId &&
        step === 2 &&
        scopeMode === 'space'
      ) {
        void loadSpaces(connectedId)
      }
    } catch (cause) {
      if (!closed.current) setError(formatAuthorizationError(cause))
    } finally {
      cancelPendingAuthorization()
      if (!closed.current) {
        setBusy(false)
        setAuthorization(null)
      }
    }
  }

  const previewScope = async () => {
    if (!selectedConnectionId || (scopeMode === 'space' ? selectedSpaceIds.length === 0 : !url.trim())) return
    setBusy(true)
    setError(null)
    try {
      if (scopeMode === 'space') {
        const results: FeishuWikiSpacePreview[] = []
        for (const spaceId of selectedSpaceIds) {
          const result = await ipcApi.request('knowledge.feishu.space.preview', {
            connectionId: selectedConnectionId,
            spaceId
          })
          if (closed.current) return
          results.push(result)
        }
        setPreview({ kind: 'space', data: results })
      } else {
        const result = await ipcApi.request('knowledge.feishu.scope.preview', {
          connectionId: selectedConnectionId,
          url: url.trim()
        })
        if (closed.current) return
        setPreview({ kind: 'url', data: result })
      }
      setStep(3)
    } catch (cause) {
      if (!closed.current)
        setError(
          formatErrorMessageWithPrefix(
            cause,
            t(
              scopeMode === 'space'
                ? 'knowledge.external.wizard.preview_space_error'
                : 'knowledge.external.wizard.preview_error'
            )
          )
        )
    } finally {
      if (!closed.current) setBusy(false)
    }
  }

  const createSource = async () => {
    if (busy || !selectedConnectionId || !preview || (policy === 'daily' && !dailyTime)) return
    setBusy(true)
    setError(null)
    const scopes =
      preview.kind === 'space'
        ? preview.data.map((item) => ({
            key: item.space.spaceId,
            scope: { spaceId: item.space.spaceId },
            name: item.space.name.trim()
          }))
        : [{ key: 'url', scope: { url: url.trim() }, name: preview.data.resolution.selected.title.trim() }]
    const failures: string[] = []
    try {
      for (const scope of scopes) {
        if (closed.current) return
        if (createdScopes.current.has(scope.key)) continue
        try {
          const source = await ipcApi.request('knowledge.external_source.create', {
            baseId,
            connectionId: selectedConnectionId,
            ...scope.scope,
            name: scope.name
          })
          createdScopes.current.add(scope.key)
          if (closed.current) return
          setCreatedCount(createdScopes.current.size)
          if (policy === 'daily') {
            try {
              await ipcApi.request('knowledge.external_source.schedule.update', {
                sourceId: source.id,
                policy: { kind: 'daily', time: dailyTime, timezone }
              })
            } catch {
              const message = t('knowledge.external.wizard.daily_warning')
              toast.error(scopes.length > 1 ? { title: message, description: scope.name } : message)
            }
          }
        } catch (cause) {
          if (closed.current) return
          failures.push(formatErrorMessageWithPrefix(cause, scope.name))
        }
      }
      if (closed.current) return
      if (failures.length > 0) {
        setError(
          [
            t(
              createdScopes.current.size > 0
                ? 'knowledge.external.wizard.partial_create_error'
                : 'knowledge.external.wizard.create_error'
            ),
            ...failures
          ].join('\n')
        )
        setBusy(false)
        return
      }
      close()
    } finally {
      if (createdScopes.current.size > 0) void invalidate('/knowledge-bases/:id/external-knowledge-sources')
    }
  }

  const connectionSelection =
    isLoadingConnections ||
    connectionsError ||
    hasConnectedConnections ||
    connections?.some(
      (connection) => connection.authorizationStatus === 'reauthorization-required' && connection.authorizedAt
    ) ? (
      <div className="space-y-4 py-2">
        {isLoadingConnections ? <p role="status">{t('common.loading')}</p> : null}
        {connectionsError ? (
          <div role="alert" className="text-error-subtle-foreground space-y-2 text-sm">
            <p>{t('knowledge.external.wizard.connection_error')}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              {t('knowledge.external.wizard.retry_connections')}
            </Button>
          </div>
        ) : null}
        {hasConnectedConnections ? (
          <Field>
            <FieldLabel id="feishu-application">{t('knowledge.external.wizard.choose_connection')}</FieldLabel>
            <Combobox
              portalContainer={document.body}
              aria-labelledby="feishu-application"
              width="100%"
              className="h-auto py-2"
              disabled={busy || connectingNewApp}
              value={selectedConnectionId ?? ''}
              options={(connections ?? [])
                .filter((connection) => connection.authorizationStatus === 'connected')
                .map((connection) => ({
                  value: connection.id,
                  label: connection.applicationName || connection.appId,
                  description: t('knowledge.external.wizard.authorized_account', {
                    name: connection.displayName || t('knowledge.external.sources.account_unknown')
                  })
                }))}
              placeholder={t('knowledge.external.wizard.choose_application')}
              searchPlaceholder={t('common.search')}
              emptyText={t('common.no_results')}
              renderValue={(value, options) => {
                const selected = options.find((option) => option.value === value)
                return selected ? (
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate">{selected.label}</span>
                    <span className="text-muted-foreground block truncate text-xs">{selected.description}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground truncate">
                    {t('knowledge.external.wizard.choose_application')}
                  </span>
                )
              }}
              onChange={(value) => selectConnection(typeof value === 'string' ? value : null)}
            />
          </Field>
        ) : null}
        {!connectionsError &&
          connections
            ?.filter(
              (connection) => connection.authorizationStatus === 'reauthorization-required' && connection.authorizedAt
            )
            .map((connection) => (
              <Button
                key={connection.id}
                type="button"
                variant="outline"
                disabled={busy || connectingNewApp}
                className="h-auto w-full justify-start py-2 text-left break-words whitespace-normal"
                onClick={() => void reconnect(connection.id)}>
                {t('knowledge.external.wizard.reauthorize', {
                  name: connection.displayName || connection.applicationName || connection.appId
                })}
              </Button>
            ))}
      </div>
    ) : null
  const errorMessage = error ? (
    <p role="alert" className="text-error-subtle-foreground text-sm whitespace-pre-line">
      {error}
    </p>
  ) : null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !isCreating && close()}>
      <DialogContent
        closeLabel={t('common.close')}
        closeOnOverlayClick={false}
        showCloseButton={!isCreating}
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t('knowledge.external.wizard.title')}</DialogTitle>
        </DialogHeader>
        {authorization ? (
          <FeishuAuthorizationStatus
            userCode={authorization.userCode}
            verificationUri={authorization.verificationUri}
            onCancel={close}
          />
        ) : null}
        <div hidden={Boolean(authorization)} className={authorization ? undefined : 'contents'}>
          {step === 1 && showAppForm ? (
            <FeishuConnectionForm
              disabled={busy}
              onBusyChange={setConnectingNewApp}
              onCancel={close}
              onConnected={(connectionId, initialScopeMode) => {
                selectConnection(connectionId)
                setScopeMode(initialScopeMode)
                setStep(2)
                void invalidate('/external-knowledge-connections')
              }}>
              {connectionSelection}
              {errorMessage}
            </FeishuConnectionForm>
          ) : (
            <>
              <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
                {step === 1 ? (
                  connectionSelection
                ) : step === 2 ? (
                  <div className="space-y-3 py-2">
                    <SegmentedControl<'space' | 'url'>
                      aria-label={t('knowledge.external.wizard.scope')}
                      value={scopeMode}
                      disabled={busy}
                      options={[
                        { value: 'space', label: t('knowledge.external.wizard.choose_space') },
                        { value: 'url', label: t('knowledge.external.wizard.paste_link') }
                      ]}
                      onValueChange={(value) => {
                        setScopeMode(value)
                        setSpacesLoading(false)
                        setPreview(null)
                        setError(null)
                      }}
                    />
                    {scopeMode === 'space' ? (
                      <div className="space-y-2">
                        {spacesLoading && spaces.length === 0 ? <p role="status">{t('common.loading')}</p> : null}
                        {spacesError ? (
                          <div role="alert" className="text-error-subtle-foreground space-y-2 text-sm">
                            <p>
                              {t(
                                spacesError === 'permission'
                                  ? 'knowledge.external.wizard.spaces_permission_error'
                                  : 'knowledge.external.wizard.spaces_error'
                              )}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={busy || spacesLoading}
                              onClick={() =>
                                selectedConnectionId && void loadSpaces(selectedConnectionId, nextPageToken)
                              }>
                              {t('knowledge.external.wizard.retry_spaces')}
                            </Button>
                            {spacesError === 'permission' && selectedConnectionId ? (
                              <div className="space-y-2">
                                <p>{t('knowledge.external.wizard.spaces_reconnect_help')}</p>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => void reconnect(selectedConnectionId, true)}>
                                  {t('knowledge.external.wizard.authorize_spaces')}
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {!spacesLoading && !spacesError && spaces.length === 0 && !nextPageToken ? (
                          <p className="text-muted-foreground text-sm">{t('knowledge.external.wizard.no_spaces')}</p>
                        ) : null}
                        {spaces.length > 0 ? (
                          <Field>
                            <FieldLabel id="feishu-available-spaces">
                              {t('knowledge.external.wizard.available_spaces')}
                            </FieldLabel>
                            <Combobox
                              multiple
                              portalContainer={document.body}
                              aria-labelledby="feishu-available-spaces"
                              width="100%"
                              disabled={busy}
                              value={selectedSpaceIds}
                              options={spaces.map((space) => ({
                                value: space.spaceId,
                                label: space.name,
                                description: space.description ?? undefined
                              }))}
                              placeholder={t('knowledge.external.wizard.choose_space')}
                              searchPlaceholder={t('common.search')}
                              emptyText={t('common.no_results')}
                              renderValue={(value, options) => (
                                <span className="min-w-0 flex-1 truncate">
                                  {options
                                    .filter((option) => value.includes(option.value))
                                    .map((option) => option.label)
                                    .join(', ') || t('knowledge.external.wizard.choose_space')}
                                </span>
                              )}
                              onChange={(value) => {
                                setSelectedSpaceIds(Array.isArray(value) ? value : [])
                                setPreview(null)
                                setError(null)
                              }}
                            />
                          </Field>
                        ) : null}
                        {nextPageToken && !spacesError ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy || spacesLoading}
                            onClick={() =>
                              selectedConnectionId && void loadSpaces(selectedConnectionId, nextPageToken)
                            }>
                            {spacesLoading ? t('common.loading') : t('knowledge.external.wizard.load_more_spaces')}
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="feishu-wiki-url">{t('knowledge.external.wizard.url')}</Label>
                        <Input
                          id="feishu-wiki-url"
                          type="url"
                          value={url}
                          placeholder={t('knowledge.external.wizard.url_placeholder')}
                          disabled={busy}
                          onChange={(event) => {
                            setUrl(event.target.value)
                            setPreview(null)
                            setError(null)
                          }}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 py-2">
                    {previewEntries.map((entry) => (
                      <section key={entry.key} aria-label={entry.title} className="space-y-2">
                        <div className="space-y-1 text-sm break-words">
                          <p className="font-medium">{entry.title}</p>
                          {preview?.kind === 'url' ? (
                            <>
                              <p className="text-muted-foreground">{preview.data.resolution.account.displayName}</p>
                              <p className="text-muted-foreground">{url}</p>
                            </>
                          ) : null}
                        </div>
                        {entry.data.warnings.includes('no-supported-documents') ? (
                          <p role="status" className="text-muted-foreground text-sm">
                            {t('knowledge.external.wizard.preview_no_supported')}
                          </p>
                        ) : null}
                        {entry.data.supportedDocxCount > 0 || entry.data.unsupportedOrSkippedCount > 0 ? (
                          <Accordion type="multiple">
                            {entry.data.supportedDocxCount > 0 ? (
                              <AccordionItem value="documents" className="border-0 first:border-t-0">
                                <AccordionTrigger className="text-muted-foreground min-h-10 py-2 font-normal">
                                  <span className="flex flex-1 items-center justify-between gap-3">
                                    <span>
                                      {t('knowledge.external.wizard.preview_supported', {
                                        count: entry.data.supportedDocxCount
                                      })}
                                    </span>
                                    <span className="text-muted-foreground text-xs">
                                      {t('knowledge.external.wizard.preview_documents')}
                                    </span>
                                  </span>
                                </AccordionTrigger>
                                <AccordionContent className="pt-1 pb-2">
                                  <ul className="max-h-48 space-y-3 overflow-y-auto pr-2">
                                    {entry.data.supportedDocuments.map((document) => (
                                      <li key={document.nodeId} className="flex items-start justify-between gap-3">
                                        <span className="min-w-0 break-words text-foreground">{document.title}</span>
                                        <span className="text-muted-foreground shrink-0 text-xs">
                                          {t(documentTypeKeys[document.documentKind])}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </AccordionContent>
                              </AccordionItem>
                            ) : null}
                            {entry.data.unsupportedOrSkippedCount > 0 ? (
                              <AccordionItem value="skipped" className="border-0 first:border-t-0">
                                <AccordionTrigger className="text-muted-foreground min-h-10 py-2 font-normal">
                                  <span className="flex flex-1 items-center justify-between gap-3">
                                    <span>
                                      {t('knowledge.external.wizard.preview_unsupported', {
                                        count: entry.data.unsupportedOrSkippedCount
                                      })}
                                    </span>
                                    <span className="text-muted-foreground text-xs">
                                      {t('knowledge.external.wizard.preview_reasons')}
                                    </span>
                                  </span>
                                </AccordionTrigger>
                                <AccordionContent className="pt-1 pb-2">
                                  <ul className="max-h-48 space-y-3 overflow-y-auto pr-2">
                                    {entry.data.skippedItems.map((item, index) => (
                                      <li key={`${item.nodeId}-${index}`} className="space-y-1">
                                        <div className="flex items-start justify-between gap-3">
                                          <span className="min-w-0 break-words text-foreground">{item.title}</span>
                                          <span className="text-muted-foreground shrink-0 text-xs">
                                            {t(
                                              item.reason === 'cross-space-shortcut'
                                                ? 'knowledge.external.wizard.document_types.cross_space_shortcut'
                                                : documentTypeKeys[item.documentKind]
                                            )}
                                          </span>
                                        </div>
                                        <p className="text-muted-foreground text-xs">
                                          {t(
                                            item.reason === 'cross-space-shortcut'
                                              ? 'knowledge.external.wizard.skip_reasons.cross_space_shortcut'
                                              : 'knowledge.external.wizard.skip_reasons.unsupported_type'
                                          )}
                                        </p>
                                      </li>
                                    ))}
                                  </ul>
                                </AccordionContent>
                              </AccordionItem>
                            ) : null}
                          </Accordion>
                        ) : null}
                      </section>
                    ))}
                    <div className="space-y-1.5">
                      <Label id="feishu-sync-frequency">{t('knowledge.external.wizard.sync_frequency')}</Label>
                      <SegmentedControl<'manual' | 'daily'>
                        aria-labelledby="feishu-sync-frequency"
                        value={policy}
                        disabled={reviewLocked}
                        options={[
                          { value: 'manual', label: t('knowledge.external.wizard.manual') },
                          { value: 'daily', label: t('knowledge.external.wizard.daily') }
                        ]}
                        onValueChange={setPolicy}
                      />
                    </div>
                    {policy === 'daily' ? (
                      <div className="space-y-1">
                        <Label htmlFor="feishu-daily-time">{t('knowledge.external.wizard.daily_time')}</Label>
                        <Input
                          id="feishu-daily-time"
                          disabled={reviewLocked}
                          required
                          aria-invalid={!dailyTime}
                          aria-describedby={!dailyTime ? 'feishu-daily-time-error' : undefined}
                          type="time"
                          value={dailyTime}
                          onChange={(event) => setDailyTime(event.target.value)}
                        />
                        {!dailyTime ? (
                          <p id="feishu-daily-time-error" role="alert" className="text-error-subtle-foreground text-xs">
                            {t('common.required_field')}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {createdCount > 0 ? (
                      <p role="status" className="text-muted-foreground text-sm">
                        {t('knowledge.external.wizard.create_progress', {
                          completed: createdCount,
                          total: previewEntries.length
                        })}
                      </p>
                    ) : null}
                  </div>
                )}

                {busy && step === 1 && !authorization ? (
                  <p role="status">{t('knowledge.external.wizard.connecting')}</p>
                ) : null}

                {errorMessage}
              </div>
              <DialogFooter className="shrink-0">
                {step > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={reviewLocked}
                    onClick={() => {
                      setError(null)
                      if (step === 2) setSpacesLoading(false)
                      setStep(step === 3 ? 2 : 1)
                    }}>
                    {t('common.back')}
                  </Button>
                ) : null}
                {step === 1 ? (
                  <Button type="button" disabled={busy || !selectedConnectionId} onClick={() => setStep(2)}>
                    {t('knowledge.external.wizard.next')}
                  </Button>
                ) : step === 2 ? (
                  <Button
                    type="button"
                    loading={busy}
                    disabled={
                      busy || (scopeMode === 'space' ? spacesLoading || selectedSpaceIds.length === 0 : !url.trim())
                    }
                    onClick={() => void previewScope()}>
                    {t('knowledge.external.wizard.next')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    loading={busy}
                    disabled={busy || (policy === 'daily' && !dailyTime)}
                    onClick={() => void createSource()}>
                    {t(createdCount > 0 ? 'common.retry' : 'common.add')}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default FeishuWikiWizard
