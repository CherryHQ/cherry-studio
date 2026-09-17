import { useNavigate } from '@tanstack/react-router'
import { ArrowUpRight, MonitorSmartphone, QrCode, Smartphone, Trash2, TriangleAlert } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type React from 'react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button, IndicatorLight, Tooltip } from '@cherrystudio/ui'
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

const DeviceConnectionsSettings: FC = () => {
  const { theme } = useTheme()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { apiGatewayConfig, apiGatewayRunning, apiGatewayLoading } = useApiGateway()
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
  const [pairingOffer, setPairingOffer] = useState<OutputFor<'api_gateway.create_pairing_offer'>>()
  const [isCreatingOffer, setIsCreatingOffer] = useState(false)
  const [isUpdatingLan, setIsUpdatingLan] = useState(false)
  const [revokingId, setRevokingId] = useState<string>()
  const pairingRequestId = useRef(0)

  const openMobileDownload = () => {
    const language = i18n.resolvedLanguage ?? i18n.language
    const url = language.startsWith('zh') ? 'https://cherryai.com.cn/mobile' : 'https://cherryai.com/mobile'
    void ipcApi.request('system.shell.open_external_website', url)
  }

  const clearPairingOffer = useCallback(() => {
    pairingRequestId.current += 1
    setPairingOffer(undefined)
    setIsCreatingOffer(false)
  }, [])

  useDataChange('/api-gateway/paired-devices', () => void refetchDevices())
  useIpcOn('api_gateway.pairing_completed', clearPairingOffer)

  useEffect(() => {
    clearPairingOffer()
    return () => {
      pairingRequestId.current += 1
    }
  }, [connectionReady, clearPairingOffer])

  useEffect(() => {
    if (!pairingOffer) return
    const timer = setTimeout(() => setPairingOffer(undefined), Math.max(0, pairingOffer.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [pairingOffer])

  const showPairingQr = async () => {
    if (!connectionReady || isCreatingOffer) return
    const requestId = ++pairingRequestId.current
    setIsCreatingOffer(true)
    try {
      const result = await ipcApi.request('api_gateway.create_pairing_offer')
      if (requestId === pairingRequestId.current && result.expiresAt > Date.now()) setPairingOffer(result)
    } catch (error) {
      if (requestId === pairingRequestId.current) {
        toast.error(t('deviceConnections.pairing.error') + ((error as Error).message || error))
      }
    } finally {
      if (requestId === pairingRequestId.current) setIsCreatingOffer(false)
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
    clearPairingOffer()
    setIsUpdatingLan(true)
    try {
      await ipcApi.request('api_gateway.lan.set_enabled', { enabled })
    } catch (error) {
      toast.error(t('deviceConnections.lan.error') + ((error as Error).message || error))
    } finally {
      setIsUpdatingLan(false)
    }
  }

  const qrPayload = pairingOffer
    ? JSON.stringify({
        v: 1,
        t: 'cherry-studio-pair',
        name: pairingOffer.hostname,
        port: pairingOffer.port,
        ips: pairingOffer.addresses,
        code: pairingOffer.code
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
        ? 'deviceConnections.description'
        : 'deviceConnections.pairing.requiresRunning'

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

      <Button
        variant="outline"
        aria-label={t('deviceConnections.downloadMobile')}
        className="mt-5 h-auto w-full justify-between gap-4 rounded-xl p-4 text-left whitespace-normal"
        onClick={openMobileDownload}>
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-background-subtle text-muted-foreground">
            <Smartphone className="size-5" />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="font-medium text-sm">{t('deviceConnections.downloadMobile')}</span>
            <span className="text-muted-foreground text-xs leading-5">{t('deviceConnections.downloadMobileHint')}</span>
          </span>
        </span>
        <span className="shrink-0 text-muted-foreground">
          <ArrowUpRight className="size-4" />
        </span>
      </Button>

      <StatusCard $ready={connectionReady}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <StatusIcon $ready={connectionReady}>
            <MonitorSmartphone size={22} />
          </StatusIcon>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <IndicatorLight
                color={connectionReady ? 'var(--success)' : 'var(--muted-foreground)'}
                size={8}
                animation={connectionReady}
                shadow={connectionReady}
              />
              <div className="font-medium text-sm">{t(statusKey)}</div>
            </div>
            <div className="text-muted-foreground text-xs">{t(statusDescriptionKey)}</div>
          </div>
        </div>
        {!gatewayAvailable ? (
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
            <Button
              variant="outline"
              loading={apiGatewayLoading || isUpdatingLan}
              onClick={() => void setLanAccess(false)}>
              {t('deviceConnections.lan.disable')}
            </Button>
          </div>
        ) : (
          <Button loading={apiGatewayLoading || isUpdatingLan} onClick={() => void setLanAccess(true)}>
            {t('deviceConnections.lan.enable')}
          </Button>
        )}
      </StatusCard>

      <Sections>
        <SettingGroup theme={theme} className="mt-0 overflow-hidden p-0">
          <SectionFields>
            <div>
              <SettingRowTitle>{t('deviceConnections.pairing.title')}</SettingRowTitle>
              <div className="mt-1 text-foreground-tertiary text-xs leading-5">
                {t('deviceConnections.pairing.hint')}
              </div>
            </div>

            <div
              role="note"
              className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-warning-subtle-foreground text-xs leading-5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{t('deviceConnections.toggle.risk')}</span>
            </div>

            {!connectionReady ? (
              <div className="text-foreground-tertiary text-xs">
                {t(
                  gatewayAvailable ? 'deviceConnections.pairing.requiresRunning' : 'deviceConnections.gateway.required'
                )}
              </div>
            ) : pairingOffer && qrPayload ? (
              <div className="flex flex-col items-start gap-2">
                <div className="rounded-lg border border-border bg-white p-3">
                  <QRCodeSVG value={qrPayload} size={180} level="M" title={t('deviceConnections.pairing.title')} />
                </div>
                <div className="font-mono text-muted-foreground text-xs">
                  {pairingOffer.addresses.map((address) => `http://${address}:${pairingOffer.port}`).join('  ')}
                </div>
              </div>
            ) : (
              <div>
                <Button variant="outline" loading={isCreatingOffer} disabled={isUpdatingLan} onClick={showPairingQr}>
                  {!isCreatingOffer && <QrCode size={14} />}
                  {t('deviceConnections.pairing.show')}
                </Button>
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
                  <div
                    key={device.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-sm">{device.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {device.platform} · {new Date(device.createdAt).toLocaleDateString()}
                      </div>
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

const StatusCard = ({ $ready, className, ...props }: React.ComponentPropsWithoutRef<'div'> & { $ready: boolean }) => (
  <div
    className={cn(
      'mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4',
      $ready
        ? 'border-success-border bg-success-subtle text-success-subtle-foreground'
        : 'border-border bg-card text-card-foreground',
      className
    )}
    {...props}
  />
)

const StatusIcon = ({ $ready, className, ...props }: React.ComponentPropsWithoutRef<'div'> & { $ready: boolean }) => (
  <div
    className={cn(
      'flex size-11 shrink-0 items-center justify-center rounded-lg border bg-background',
      $ready ? 'border-success-border text-success' : 'border-border text-muted-foreground',
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
