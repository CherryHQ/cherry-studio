import {
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  Laptop,
  Network,
  Play,
  RotateCcw,
  Square,
  Terminal
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { v4 as uuidv4 } from 'uuid'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  IndicatorLight,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputNumber,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tooltip
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import CopyButton from '@renderer/components/CopyButton'
import { GatewayIcon } from '@renderer/components/icons/GatewayIcon'
import { useApiGateway } from '@renderer/hooks/useApiGateway'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { openExternalWebsite } from '@renderer/services/website'
import { cn } from '@renderer/utils/style'
import { gatewayClientOrigin } from '@shared/utils/apiGateway'

const PORT_MIN = 1000
const PORT_MAX = 65535
const connectionRow = 'grid min-w-0 items-center gap-x-4 gap-y-1.5 py-1 @min-[29rem]:grid-cols-[9rem_minmax(0,1fr)]'
const gatewayNode = 'absolute grid size-7 place-items-center rounded-md border bg-card text-success [&>svg]:size-3.5'

function GatewayIllustration({ running, sharing }: { running: boolean; sharing: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none relative flex h-24 items-center justify-center overflow-hidden rounded-xl border bg-linear-to-r from-card via-success-subtle/55 to-card',
        !running && 'grayscale'
      )}>
      <div className="absolute inset-0 bg-[radial-gradient(var(--success-border)_1px,transparent_1px)] bg-size-[11px_11px] mask-[radial-gradient(ellipse,black,transparent_75%)]" />
      <div className={cn('relative h-24 w-full max-w-52', !running && 'opacity-60')}>
        <div className="absolute start-[17%] top-12 w-[26%] border-t border-success-border" />
        <div className="absolute start-[57%] top-6 h-6 w-[25%] rounded-ss-lg border-s border-t border-success-border" />
        <div
          className={cn(
            'absolute start-[57%] top-12 h-6 w-[25%] rounded-es-lg border-s border-b border-success-border',
            !sharing && 'border-dashed'
          )}
        />
        <div className={cn(gatewayNode, 'start-[5%] top-8')}>
          <Terminal />
        </div>
        <div className={cn(gatewayNode, 'end-[6%] top-2')}>
          <Laptop />
        </div>
        <div className={cn(gatewayNode, 'end-[6%] top-16', !sharing && 'text-muted-foreground opacity-60')}>
          <Network />
        </div>
        <div className="absolute start-[33%] top-1/2 grid h-12 w-14 -translate-y-1/2 place-items-center rounded-xl border border-success-border bg-linear-to-br from-card to-success-subtle text-success">
          <GatewayIcon width={25} height={25} />
          <span className="absolute end-1.5 bottom-1.5 size-1 rounded-full bg-current" />
        </div>
      </div>
    </div>
  )
}

function GatewayEndpoints({ origin }: { origin: string }) {
  const { t } = useTranslation()
  const endpoints = [
    [t('settings.models.base_url'), '/v1'],
    [t('settings.provider.more_endpoints.openai_chat'), '/v1/chat/completions'],
    [t('settings.provider.more_endpoints.openai_responses'), '/v1/responses'],
    [t('endpoint_type.anthropic'), '/v1/messages']
  ] as const

  return (
    <div>
      {endpoints.map(([label, path]) => {
        const url = origin + path
        return (
          <div key={path} className={connectionRow}>
            <span className="text-sm font-medium">{label}</span>
            <div className="flex min-h-9 min-w-0 items-center justify-between gap-2 rounded-md border bg-muted/40 ps-2.5 pe-0.5">
              <code className="min-w-0 select-text py-1 font-mono text-sm wrap-anywhere">{url}</code>
              <Button variant="ghost" size="sm" className="shrink-0" asChild>
                <CopyButton
                  textToCopy={url}
                  label={t('common.copy')}
                  aria-label={`${t('common.copy')} · ${label}`}
                  successFeedback="icon"
                />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function GatewayModels() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const { data, error, isLoading } = useSWR('api_gateway.models', () => ipcApi.request('api_gateway.models'))
  if (isLoading)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('apiGateway.connections.models_failed')}
      </p>
    )
  if (!data?.length) return <p className="text-sm text-muted-foreground">{t('models.no_matches')}</p>

  const query = search.trim().toLowerCase()
  const models = data.filter(({ id, owned_by }) => `${id} ${owned_by}`.toLowerCase().includes(query))

  return (
    <>
      <Input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        aria-label={t('models.search.placeholder')}
        placeholder={t('models.search.placeholder')}
        className="mb-2 h-8"
      />
      {models.length ? (
        <ul className="max-h-64 overflow-y-auto">
          {models.map(({ id, owned_by }) => (
            <li key={id} className="flex min-w-0 items-center gap-2 py-1">
              <div className="min-w-0 flex-1">
                <code className="block font-mono text-xs wrap-anywhere">{id.slice(id.indexOf(':') + 1)}</code>
                <span className="block text-xs text-muted-foreground wrap-anywhere">{owned_by}</span>
              </div>
              <Tooltip asChild content={id} placement="top-end" className="font-mono wrap-anywhere">
                <Button variant="ghost" size="icon-sm" className="shrink-0" asChild>
                  <CopyButton textToCopy={id} aria-label={`${t('common.copy')} · ${id}`} successFeedback="icon" />
                </Button>
              </Tooltip>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-2 text-sm text-muted-foreground">{t('common.no_results')}</p>
      )}
    </>
  )
}

function GatewayCredential({
  apiKey,
  running,
  regenerate
}: {
  apiKey: string
  running: boolean
  regenerate: () => void
}) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const visibilityLabel = t(visible ? 'settings.provider.api_key.hide_key' : 'settings.provider.api_key.show_key')
  return (
    <div className={connectionRow}>
      <div className="text-sm font-medium">{t('apiGateway.fields.apiKey.label')}</div>
      <InputGroup className="max-w-md bg-muted/50">
        <InputGroupInput
          className="font-mono text-sm"
          aria-label={t('apiGateway.fields.apiKey.label')}
          type={visible ? 'text' : 'password'}
          value={apiKey}
          placeholder={t('apiGateway.fields.apiKey.placeholder')}
          readOnly
        />
        <InputGroupAddon align="inline-end">
          {!running && (
            <InputGroupButton
              size="icon-xs"
              aria-label={t('apiGateway.actions.regenerate')}
              title={t('apiGateway.actions.regenerate')}
              onClick={regenerate}>
              <RotateCcw />
            </InputGroupButton>
          )}
          <InputGroupButton
            size="icon-xs"
            aria-label={visibilityLabel}
            title={visibilityLabel}
            onClick={() => setVisible(!visible)}
            disabled={!apiKey}>
            {visible ? <EyeOff /> : <Eye />}
          </InputGroupButton>
          <InputGroupButton size="icon-xs" asChild>
            <CopyButton
              textToCopy={apiKey}
              tooltip={t('apiGateway.fields.apiKey.copyTooltip')}
              successFeedback="icon"
              disabled={!apiKey}
            />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

export default function ApiGatewayPanel({ renderHeader }: { renderHeader?: (controls: ReactNode) => ReactNode }) {
  const { t } = useTranslation()
  const {
    apiGatewayConfig,
    apiGatewayRunning,
    apiGatewayEndpoint,
    apiGatewayLoading,
    startApiGateway,
    stopApiGateway,
    restartApiGateway,
    setApiGatewayConfig
  } = useApiGateway()
  const [lanEnabled] = usePreference('feature.api_gateway.lan_http_enabled')
  const [lanUpdating, setLanUpdating] = useState(false)
  const [selectedAddress, setSelectedAddress] = useState('')
  const [lanError, setLanError] = useState('')
  const lanRunning = lanEnabled && apiGatewayRunning && apiGatewayEndpoint?.host === '0.0.0.0'
  const {
    data: lanAddresses,
    isLoading: addressesLoading,
    error: addressesError
  } = useSWR(
    lanRunning ? ['api_gateway.lan_http.addresses', apiGatewayEndpoint.port] : null,
    () => ipcApi.request('api_gateway.lan_http.addresses'),
    { refreshInterval: 5000 }
  )
  const lanOrigin = lanAddresses?.find((address) => address === selectedAddress) ?? lanAddresses?.[0]
  const port = (apiGatewayRunning && apiGatewayEndpoint?.port) || apiGatewayConfig.port || 23333
  const localOrigin = gatewayClientOrigin('127.0.0.1', port)
  const apiKey = apiGatewayConfig.apiKey || ''

  const setLanAccess = async (enabled: boolean) => {
    setLanUpdating(true)
    setLanError('')
    try {
      await ipcApi.request('api_gateway.lan_http.set_enabled', { enabled })
    } catch (error) {
      setLanError(error instanceof Error ? error.message : String(error))
    } finally {
      setLanUpdating(false)
    }
  }

  const handlePortChange = (value: number | null) => {
    if (value === null) return
    if (value < PORT_MIN || value > PORT_MAX) {
      toast.error(t('apiGateway.messages.portInvalid', { min: PORT_MIN, max: PORT_MAX }))
      return
    }
    void setApiGatewayConfig({ port: value })
  }

  const credential = (
    <GatewayCredential
      key={apiKey}
      apiKey={apiKey}
      running={apiGatewayRunning}
      regenerate={async () => {
        await setApiGatewayConfig({ apiKey: `cs-sk-${uuidv4()}` })
        toast.success(t('apiGateway.messages.apiKeyRegenerated'))
      }}
    />
  )

  const controls = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div
        role="status"
        className={cn(
          'flex items-center gap-1.5 text-xs font-medium',
          apiGatewayRunning ? 'text-success' : 'text-muted-foreground'
        )}>
        <IndicatorLight color="currentColor" size={7} />
        {t(apiGatewayRunning ? 'apiGateway.status.running' : 'apiGateway.status.stopped')}
      </div>
      {apiGatewayRunning ? (
        <Button size="sm" variant="outline" loading={apiGatewayLoading} disabled={lanUpdating} onClick={stopApiGateway}>
          {!apiGatewayLoading && <Square size={14} />}
          {t('apiGateway.actions.stop')}
        </Button>
      ) : (
        <Button size="sm" loading={apiGatewayLoading} disabled={lanUpdating} onClick={startApiGateway}>
          {!apiGatewayLoading && <Play size={14} />}
          {t('apiGateway.actions.start')}
        </Button>
      )}
    </div>
  )

  return (
    <div data-ui="api-gateway.panel" className="@container flex flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-3">
        {renderHeader ? renderHeader(controls) : controls}
        <GatewayIllustration running={apiGatewayRunning} sharing={lanRunning} />
      </div>

      <section aria-label={t('apiGateway.connections.local')} className="min-w-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('apiGateway.connections.local')}</h2>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="group">
                {t('common.models')}
                <ChevronDown className="size-3.5 group-data-[state=open]:rotate-180" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              aria-label={t('common.models')}
              className="w-80 max-w-[var(--radix-popover-content-available-width)] p-2.5">
              <GatewayModels />
            </PopoverContent>
          </Popover>
        </div>
        <GatewayEndpoints origin={localOrigin} />
      </section>

      <section aria-label={t('apiGateway.connections.lan')} className="flex min-w-0 flex-col">
        <div className="flex min-h-14 items-center justify-between gap-4">
          <h2 className="text-sm font-semibold">{t('apiGateway.connections.lan')}</h2>
          <Switch
            aria-label={t('apiGateway.connections.lan')}
            checked={Boolean(lanEnabled)}
            disabled={apiGatewayLoading || lanUpdating || (!apiGatewayRunning && !lanEnabled)}
            loading={lanUpdating}
            onCheckedChange={setLanAccess}
          />
        </div>
        {lanError && (
          <p role="alert" className="text-sm text-destructive">
            {t('deviceConnections.lan.error')}
            {lanError}
          </p>
        )}
        {lanEnabled && (
          <div className="flex min-w-0 flex-col gap-2 pb-4">
            {lanRunning ? (
              lanOrigin ? (
                <>
                  {!!lanAddresses && lanAddresses.length > 1 && (
                    <Select value={lanOrigin} onValueChange={setSelectedAddress}>
                      <SelectTrigger
                        aria-label={t('apiGateway.connections.lan')}
                        className="max-w-md @min-[29rem]:ms-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {lanAddresses.map((address) => (
                          <SelectItem key={address} value={address}>
                            {address}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <GatewayEndpoints origin={lanOrigin} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t(
                    addressesLoading
                      ? 'common.loading'
                      : addressesError
                        ? 'apiGateway.connections.addresses_failed'
                        : 'apiGateway.connections.no_address'
                  )}
                </p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">{t('apiGateway.messages.notEnabled')}</p>
            )}
            {credential}
            <p className="text-xs text-muted-foreground">{t('apiGateway.connections.lan_http')}</p>
          </div>
        )}
      </section>

      <Accordion type="single" collapsible className="-mt-3">
        <AccordionItem value="advanced" className="first:border-t-0">
          <AccordionTrigger className="w-fit flex-none justify-start gap-2 py-2 text-xs font-medium text-muted-foreground">
            {t('common.advanced_settings')}
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">{t('apiGateway.fields.port.label')}</span>
              <InputNumber
                className="w-32 font-mono text-xs tabular-nums"
                aria-label={t('apiGateway.fields.port.label')}
                step={1}
                value={port}
                disabled={apiGatewayRunning}
                onBlur={handlePortChange}
              />
            </div>
            {!lanEnabled && credential}
            {apiGatewayRunning && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void openExternalWebsite(`${localOrigin}/openapi`)}>
                  <ExternalLink size={13} />
                  {t('apiGateway.documentation.title')}
                </Button>
                <Button
                  variant="outline"
                  loading={apiGatewayLoading}
                  disabled={lanUpdating}
                  onClick={restartApiGateway}>
                  {!apiGatewayLoading && <RotateCcw size={14} />}
                  {t('apiGateway.actions.restart.button')}
                </Button>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
