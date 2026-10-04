import { useNavigate } from '@tanstack/react-router'
import { ArrowUpRight, MonitorSmartphone, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type React from 'react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { RemoteCapability } from '@cherrystudio/remote-protocol'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  IndicatorLight,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip
} from '@cherrystudio/ui'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { useDataChange, useMutation, useQuery } from '@data/hooks/useDataApi'
import {
  SettingGroup,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useApiGateway } from '@renderer/hooks/useApiGateway'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import type { OutputFor } from '@shared/ipc/types'

const LAN_HOST = '0.0.0.0'
const CAPABILITY_LABEL = {
  configuration: 'deviceConnections.capabilities.configuration',
  agent: 'deviceConnections.capabilities.agent'
} as const

type Invitation = OutputFor<'api_gateway.remote.create_invitation'>
type PairingClaim = OutputFor<'api_gateway.remote.list_claims'>[number]

const DeviceConnectionsSettings: FC = () => {
  const { theme } = useTheme()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { apiGatewayConfig, apiGatewayRunning, apiGatewayLoading } = useApiGateway()
  const discoveryStatus = useSharedCacheValue('feature.remote_access.discovery_status')
  const lanRunning = useSharedCacheValue('feature.api_gateway.lan_running') ?? false
  const {
    data: devices = [],
    isLoading: isLoadingDevices,
    isRefreshing: isRefreshingDevices,
    error: devicesError,
    refetch: refetchDevices
  } = useQuery('/api-gateway/paired-devices')
  const { trigger: deleteDevice, isLoading: isRevoking } = useMutation('DELETE', '/api-gateway/paired-devices/:id', {
    refresh: ['/api-gateway/paired-devices']
  })

  const lanEnabled = apiGatewayConfig.host === LAN_HOST
  const gatewayAvailable = apiGatewayConfig.enabled && apiGatewayRunning
  const connectionReady = lanEnabled && lanRunning && gatewayAvailable
  const [invitation, setInvitation] = useState<Invitation>()
  const [selectedAddress, setSelectedAddress] = useState('auto')
  const [invitationExpired, setInvitationExpired] = useState(false)
  const [claims, setClaims] = useState<PairingClaim[]>([])
  const [selectedCapabilities, setSelectedCapabilities] = useState<Record<string, RemoteCapability[]>>({})
  const [decidingClaimId, setDecidingClaimId] = useState<string>()
  const [isCreatingInvitation, setIsCreatingInvitation] = useState(false)
  const [isUpdatingLan, setIsUpdatingLan] = useState(false)
  const [revokingId, setRevokingId] = useState<string>()
  const invitationRequestId = useRef(0)
  const claimRequestId = useRef(0)

  const openMobileDownload = () => {
    const language = i18n.resolvedLanguage ?? i18n.language
    const url = language.startsWith('zh') ? 'https://cherryai.com.cn/mobile' : 'https://cherryai.com/mobile'
    void ipcApi.request('system.shell.open_external_website', url)
  }

  const clearInvitation = useCallback(() => {
    invitationRequestId.current += 1
    claimRequestId.current += 1
    setInvitation(undefined)
    setClaims([])
    setIsCreatingInvitation(false)
  }, [])

  const refreshClaims = useCallback(async () => {
    if (!connectionReady) return
    const requestId = ++claimRequestId.current
    try {
      const pending = await ipcApi.request('api_gateway.remote.list_claims')
      if (requestId === claimRequestId.current) setClaims(pending)
    } catch {
      if (requestId === claimRequestId.current) setClaims([])
    }
  }, [connectionReady])

  useDataChange('/api-gateway/paired-devices', () => void refetchDevices())
  useIpcOn('api_gateway.remote.pairing_changed', () => void refreshClaims())

  const showPairingQr = useCallback(async () => {
    if (!connectionReady) return
    const requestId = ++invitationRequestId.current
    setIsCreatingInvitation(true)
    setInvitationExpired(false)
    setInvitation(undefined)
    try {
      const result = await ipcApi.request('api_gateway.remote.create_invitation')
      if (requestId === invitationRequestId.current && Date.parse(result.expiresAt) > Date.now()) setInvitation(result)
    } catch (error) {
      if (requestId === invitationRequestId.current) {
        toast.error(t('deviceConnections.pairing.error') + ((error as Error).message || error))
      }
    } finally {
      if (requestId === invitationRequestId.current) setIsCreatingInvitation(false)
    }
  }, [connectionReady, t])

  useEffect(() => {
    clearInvitation()
    void refreshClaims()
    void showPairingQr()
    return () => {
      invitationRequestId.current += 1
      claimRequestId.current += 1
    }
  }, [refreshClaims, clearInvitation, showPairingQr])

  useEffect(() => {
    if (!invitation) return
    const timer = setTimeout(
      () => {
        clearInvitation()
        setInvitationExpired(true)
      },
      Math.max(0, Date.parse(invitation.expiresAt) - Date.now())
    )
    return () => clearTimeout(timer)
  }, [invitation, clearInvitation])

  const decideClaim = async (claim: PairingClaim, capabilities: RemoteCapability[] | null) => {
    if (decidingClaimId) return
    setDecidingClaimId(claim.claimId)
    try {
      await ipcApi.request('api_gateway.remote.decide_pairing', { claimId: claim.claimId, capabilities })
      if (capabilities) toast.success(t('deviceConnections.claims.approved'))
      clearInvitation()
    } catch (error) {
      toast.error(t('deviceConnections.claims.error') + ((error as Error).message || error))
    } finally {
      setDecidingClaimId(undefined)
    }
  }

  const revokeDevice = useCallback(
    async (id: string) => {
      if (isRevoking) return
      setRevokingId(id)
      try {
        await deleteDevice({ params: { id } })
        toast.success(t('deviceConnections.devices.revoked'))
      } catch {
        toast.error(t('common.delete_failed'))
      } finally {
        setRevokingId(undefined)
      }
    },
    [deleteDevice, isRevoking, t]
  )

  const setLanAccess = async (enabled: boolean) => {
    if (apiGatewayLoading || isUpdatingLan) return
    clearInvitation()
    setIsUpdatingLan(true)
    try {
      await ipcApi.request('api_gateway.lan.set_enabled', { enabled })
    } catch (error) {
      toast.error(t('deviceConnections.lan.error') + ((error as Error).message || error))
    } finally {
      setIsUpdatingLan(false)
    }
  }

  const selectedAddressAvailable =
    selectedAddress === 'auto' || invitation?.addressOptions.some(({ address }) => address === selectedAddress)
  const qrPayload =
    invitation && selectedAddressAvailable && !isCreatingInvitation
      ? JSON.stringify({
          v: 2,
          t: 'cherry-studio-pair',
          name: invitation.hostname,
          port: invitation.port,
          ips: selectedAddress === 'auto' ? invitation.addresses : [selectedAddress],
          invitationId: invitation.invitationId,
          invitationSecret: invitation.invitationSecret,
          desktopIdentity: invitation.desktopIdentity,
          protocolVersions: invitation.protocolVersions
        })
      : null
  const statusKey = connectionReady
    ? 'deviceConnections.status.ready'
    : lanEnabled
      ? 'deviceConnections.status.stopped'
      : 'deviceConnections.status.disabled'
  const statusDescriptionKey = !gatewayAvailable
    ? 'deviceConnections.gateway.required'
    : !lanEnabled
      ? 'deviceConnections.toggle.description'
      : connectionReady
        ? 'deviceConnections.toggle.enabled'
        : 'deviceConnections.pairing.requiresRunning'

  const connectionAction = !gatewayAvailable ? (
    <Button
      variant="outline"
      disabled={apiGatewayLoading}
      onClick={() => void navigate({ to: '/settings/api-gateway' })}>
      {t('deviceConnections.gateway.openSettings')}
    </Button>
  ) : lanEnabled ? (
    <div className="flex items-center gap-2">
      {!lanRunning && (
        <Button loading={apiGatewayLoading || isUpdatingLan} onClick={() => void setLanAccess(true)}>
          {t('common.retry')}
        </Button>
      )}
      <Button variant="outline" loading={apiGatewayLoading || isUpdatingLan} onClick={() => void setLanAccess(false)}>
        {t('deviceConnections.lan.disable')}
      </Button>
    </div>
  ) : (
    <Button loading={apiGatewayLoading || isUpdatingLan} onClick={() => void setLanAccess(true)}>
      {t('deviceConnections.lan.enable')}
    </Button>
  )

  return (
    <SettingsContentColumn
      theme={theme}
      className="flex h-[calc(100vh-var(--navbar-height))] flex-col"
      innerClassName="pb-6">
      <div className="min-w-0">
        <SettingTitle className="justify-start gap-2">
          <MonitorSmartphone size={16} />
          {t('deviceConnections.title')}
        </SettingTitle>
        <PageDescription>{t('deviceConnections.description')}</PageDescription>
      </div>

      <StatusCard>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <StatusIcon $ready={connectionReady}>
            <MonitorSmartphone size={22} />
          </StatusIcon>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <IndicatorLight color={connectionReady ? 'var(--success)' : 'var(--muted-foreground)'} size={8} />
              <div className="font-medium text-sm">{t(statusKey)}</div>
            </div>
            <div className="text-muted-foreground text-xs leading-relaxed">{t(statusDescriptionKey)}</div>
            {connectionReady && discoveryStatus === 'unavailable' && (
              <div className="text-warning text-xs">{t('deviceConnections.discovery.unavailable')}</div>
            )}
          </div>
        </div>
        {connectionAction}
      </StatusCard>

      <Sections>
        <SettingGroup theme={theme} className="mt-0 overflow-hidden p-0">
          <SectionFields>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <SettingRowTitle>{t('deviceConnections.pairing.title')}</SettingRowTitle>
                <div className="mt-1 text-foreground-tertiary text-xs leading-5">
                  {t('deviceConnections.pairing.hint')}
                </div>
              </div>
              <Tooltip content={t('deviceConnections.downloadMobileHint')}>
                <Button variant="ghost" size="sm" onClick={openMobileDownload}>
                  {t('deviceConnections.downloadMobile')}
                  <ArrowUpRight className="size-3.5" />
                </Button>
              </Tooltip>
            </div>

            {(invitation || claims.length > 0) && (
              <div
                role="note"
                className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-warning-subtle-foreground text-xs leading-5">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>{t('deviceConnections.toggle.risk')}</span>
              </div>
            )}

            {!connectionReady ? (
              <div className="text-foreground-tertiary text-xs">
                {t(
                  gatewayAvailable ? 'deviceConnections.pairing.requiresRunning' : 'deviceConnections.gateway.required'
                )}
              </div>
            ) : claims.length > 0 ? (
              claims.map((claim) => {
                const selected = selectedCapabilities[claim.claimId] ?? claim.capabilities
                return (
                  <div
                    key={claim.claimId}
                    role="group"
                    aria-label={t('deviceConnections.claims.title')}
                    className="flex flex-col gap-3 rounded-lg border border-border p-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-sm">{claim.deviceName}</div>
                      <div className="text-muted-foreground text-xs">{claim.platform}</div>
                    </div>
                    <div className="font-mono text-2xl tracking-[0.3em]">{claim.verificationCode}</div>
                    <div className="text-foreground-tertiary text-xs leading-5">
                      {t('deviceConnections.claims.codeHint')}
                    </div>
                    <div className="flex flex-col gap-2">
                      {claim.capabilities.map((capability) => (
                        <label key={capability} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={selected.includes(capability)}
                            onCheckedChange={(checked) =>
                              setSelectedCapabilities((current) => ({
                                ...current,
                                [claim.claimId]: claim.capabilities.filter((value) =>
                                  value === capability ? checked === true : selected.includes(value)
                                )
                              }))
                            }
                          />
                          {t(CAPABILITY_LABEL[capability])}
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        loading={decidingClaimId === claim.claimId}
                        disabled={selected.length === 0}
                        onClick={() => void decideClaim(claim, selected)}>
                        {t('deviceConnections.claims.approve')}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={decidingClaimId !== undefined}
                        onClick={() => void decideClaim(claim, null)}>
                        {t('deviceConnections.claims.reject')}
                      </Button>
                    </div>
                  </div>
                )
              })
            ) : invitation ? (
              <div className="flex flex-col items-start gap-3">
                <label htmlFor="pairing-address" className="text-sm font-medium">
                  {t('deviceConnections.pairing.address')}
                </label>
                <div className="flex w-full max-w-lg items-start gap-2">
                  <Select value={selectedAddress} onValueChange={setSelectedAddress} disabled={isCreatingInvitation}>
                    <SelectTrigger
                      id="pairing-address"
                      className="h-auto min-h-9 w-full min-w-0 [&_[data-slot=select-value]]:line-clamp-none [&_[data-slot=select-value]]:whitespace-normal [&_[data-slot=select-value]]:break-all">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-80 max-w-[calc(100vw-2rem)]">
                      <SelectItem value="auto">{t('deviceConnections.pairing.automatic')}</SelectItem>
                      {!selectedAddressAvailable && (
                        <SelectItem value={selectedAddress} disabled>
                          {selectedAddress}
                        </SelectItem>
                      )}
                      {invitation.addressOptions.map(({ address, interfaceName }) => (
                        <SelectItem key={address} value={address} className="whitespace-normal break-all">
                          {address} ({interfaceName})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    loading={isCreatingInvitation}
                    aria-label={t('deviceConnections.pairing.refreshAddresses')}
                    onClick={() => void showPairingQr()}>
                    <RefreshCw size={16} />
                  </Button>
                </div>
                {!selectedAddressAvailable && (
                  <p role="alert" className="text-destructive text-sm">
                    {t('deviceConnections.pairing.addressUnavailable')}
                  </p>
                )}
                {qrPayload && (
                  <div className="rounded-lg border border-border bg-white p-3">
                    <QRCodeSVG value={qrPayload} size={180} level="M" title={t('deviceConnections.pairing.title')} />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-start gap-2">
                {isCreatingInvitation ? (
                  <span className="text-muted-foreground text-sm">{t('common.loading')}</span>
                ) : (
                  <>
                    {invitationExpired && (
                      <p className="text-muted-foreground text-sm">{t('deviceConnections.pairing.expired')}</p>
                    )}
                    <Button disabled={isUpdatingLan} onClick={showPairingQr}>
                      <RefreshCw size={14} />
                      {t('common.refresh')}
                    </Button>
                  </>
                )}
              </div>
            )}
          </SectionFields>
        </SettingGroup>

        <SettingGroup theme={theme} className="mt-0 overflow-hidden p-0">
          <SectionFields>
            <SettingRowTitle>{t('deviceConnections.devices.title')}</SettingRowTitle>
            {devicesError ? (
              <Alert
                type="error"
                showIcon
                message={t('deviceConnections.devices.loadError')}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    loading={isRefreshingDevices}
                    onClick={() => void refetchDevices().catch(() => {})}>
                    {t('common.retry')}
                  </Button>
                }
              />
            ) : isLoadingDevices ? (
              <div role="status" className="text-foreground-tertiary text-xs">
                {t('common.loading')}
              </div>
            ) : devices.length > 0 ? (
              <div className="flex flex-col gap-2">
                {devices.map((device) => (
                  <div key={device.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-sm">{device.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {device.platform} · {new Date(device.createdAt).toLocaleDateString()}
                      </div>
                      {device.remoteAccess && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {device.remoteAccess.capabilities.map((capability) => (
                            <Badge key={capability} variant="outline">
                              {t(CAPABILITY_LABEL[capability])}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <Tooltip content={t('deviceConnections.devices.revoke')}>
                      <Button
                        variant="ghost"
                        size="icon"
                        loading={revokingId === device.id}
                        aria-label={t('deviceConnections.devices.revoke')}
                        onClick={() => void revokeDevice(device.id)}>
                        {revokingId !== device.id && <Trash2 size={14} />}
                      </Button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-foreground-tertiary text-xs">{t('deviceConnections.devices.empty')}</div>
            )}
          </SectionFields>
        </SettingGroup>
      </Sections>
    </SettingsContentColumn>
  )
}

const PageDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-2 max-w-140 text-foreground-tertiary text-xs leading-5', className)} {...props} />
)

const StatusCard = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4',
      className
    )}
    {...props}
  />
)

const StatusIcon = ({ $ready, className, ...props }: React.ComponentPropsWithoutRef<'div'> & { $ready: boolean }) => (
  <div
    className={cn(
      'flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-subtle',
      $ready ? 'text-success' : 'text-muted-foreground',
      className
    )}
    {...props}
  />
)

const Sections = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mt-4 flex flex-col gap-4', className)} {...props} />
)

const SectionFields = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-col gap-4 p-4', className)} {...props} />
)

export default DeviceConnectionsSettings
