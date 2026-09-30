import { ChevronDown, ChevronRight, Globe, Smartphone } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { directEndpointUrl } from '@cherrystudio/remote-protocol'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@cherrystudio/ui'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { useSkillLauncher } from '@renderer/hooks/useSkillLauncher'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import { ipcApi } from '@renderer/ipc'
import type { OutputFor } from '@shared/ipc/types'

const TAILSCALE_DOWNLOAD = 'https://tailscale.com/download'
const VPN_STATE_KEYS = {
  ready: 'deviceConnections.setup.ready',
  'needs-login': 'deviceConnections.setup.needsLogin',
  'needs-approval': 'deviceConnections.setup.needsApproval',
  offline: 'deviceConnections.setup.offline',
  unknown: 'deviceConnections.setup.unknown',
  'not-detected': 'deviceConnections.setup.notDetected'
} as const

export function ConnectionSetup({
  connectionReady,
  prerequisite
}: {
  connectionReady: boolean
  prerequisite: ReactNode
}) {
  const { t } = useTranslation()
  const listeningEndpoint = useSharedCacheValue('feature.api_gateway.endpoint')
  const launchSkill = useSkillLauncher()
  const { skills } = useInstalledSkills()
  const skill = skills.find((item) => item.folderName === 'device-connection-setup')
  const [open, setOpen] = useState(false)
  const [showPhoneDownload, setShowPhoneDownload] = useState(false)
  const phoneDownloadId = useId()
  const [networks, setNetworks] = useState<OutputFor<'api_gateway.remote.check_networks'>>()
  const [snapshot, setSnapshot] = useState<OutputFor<'api_gateway.remote.get_endpoints'>>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [installOutcome, setInstallOutcome] = useState<OutputFor<'api_gateway.remote.install_tailscale'>['outcome']>()
  const generation = useRef(0)
  const working = useRef(false)

  const check = useCallback(async () => {
    if (!connectionReady || working.current) return
    working.current = true
    const request = ++generation.current
    setBusy(true)
    setError(false)
    setSnapshot(undefined)
    try {
      const [networks, endpoint] = await Promise.all([
        ipcApi.request('api_gateway.remote.check_networks'),
        ipcApi.request('api_gateway.remote.get_endpoints')
      ])
      if (request !== generation.current) return
      setNetworks(networks)
      setSnapshot(endpoint)
    } catch {
      if (request === generation.current) setError(true)
    } finally {
      if (request === generation.current) {
        setBusy(false)
        working.current = false
      }
    }
  }, [connectionReady])

  useEffect(() => {
    generation.current++
    setSnapshot(undefined)
    setShowPhoneDownload(false)
    setNetworks(undefined)
    setError(false)
    setBusy(false)
    working.current = false
    if (open && connectionReady) void check()
    return () => {
      generation.current++
    }
  }, [open, connectionReady, check])

  const install = async () => {
    if (working.current) return
    working.current = true
    const request = ++generation.current
    setBusy(true)
    setError(false)
    try {
      const result = await ipcApi.request('api_gateway.remote.install_tailscale')
      if (request === generation.current) setInstallOutcome(result.outcome)
    } catch {
      if (request === generation.current) setError(true)
    } finally {
      if (request === generation.current) {
        setBusy(false)
        working.current = false
      }
    }
  }

  const detectedNetworks = networks?.filter((network) => network.state !== 'not-detected')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="mt-6 h-auto w-full justify-between gap-3 py-3 text-start whitespace-normal">
          <span className="flex items-center gap-3">
            <Globe className="size-4 shrink-0 text-muted-foreground" />
            {t('deviceConnections.setup.remoteHint')}
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('common.close')} className="flex max-h-[calc(100dvh-2rem)] flex-col gap-6">
        <DialogHeader className="pe-6 text-start">
          <DialogTitle>{t('deviceConnections.setup.remoteHint')}</DialogTitle>
          <DialogDescription className="leading-6">{t('deviceConnections.setup.hint')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 space-y-6 overflow-x-hidden overflow-y-auto">
          {!connectionReady ? (
            prerequisite
          ) : (
            <div className="space-y-6">
              <div className="space-y-3" aria-live="polite" aria-busy={busy}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-medium text-sm">{t('deviceConnections.setup.title')}</h3>
                  <Button variant="outline" size="sm" loading={busy} onClick={() => void check()}>
                    {t('deviceConnections.setup.check')}
                  </Button>
                </div>
                {detectedNetworks?.map((network) => (
                  <div
                    key={network.product}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                    <span>{network.product === 'tailscale' ? 'Tailscale' : 'ZeroTier'}</span>
                    <span className="text-muted-foreground text-xs">{t(VPN_STATE_KEYS[network.state])}</span>
                  </div>
                ))}
                {networks && detectedNetworks?.length === 0 && (
                  <p className="text-muted-foreground text-sm">{t('deviceConnections.setup.notDetected')}</p>
                )}
                {error && <Alert type="error" message={t('deviceConnections.setup.failed')} />}
              </div>
              <div className="flex gap-3 rounded-lg bg-background-subtle p-4">
                <Smartphone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="space-y-1">
                  <h3 className="font-medium text-sm">{t('deviceConnections.setup.phoneTitle')}</h3>
                  <p className="text-muted-foreground text-sm leading-6">{t('deviceConnections.setup.saveOnPhone')}</p>
                </div>
              </div>
              <Accordion type="single" collapsible>
                <AccordionItem value="tailscale">
                  <AccordionTrigger className="text-start font-normal">
                    {t('deviceConnections.setup.tailscaleGuide')}
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4 text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-3">
                      {networks?.find((item) => item.product === 'tailscale')?.state === 'not-detected' && (
                        <Button disabled={busy} onClick={() => void install()}>
                          {t('deviceConnections.setup.install')}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => void ipcApi.request('system.shell.open_external_website', TAILSCALE_DOWNLOAD)}>
                        {t('deviceConnections.setup.official')}
                      </Button>
                    </div>
                    {installOutcome && (
                      <p role="status">
                        {t(
                          installOutcome === 'manual-required'
                            ? 'deviceConnections.setup.manual'
                            : 'deviceConnections.setup.finishSetup'
                        )}
                      </p>
                    )}
                    <div className="space-y-4">
                      <Button
                        variant="outline"
                        className="h-auto gap-2 whitespace-normal text-start"
                        aria-expanded={showPhoneDownload}
                        aria-controls={phoneDownloadId}
                        onClick={() => setShowPhoneDownload((shown) => !shown)}>
                        <Smartphone className="size-4 shrink-0" />
                        {t('deviceConnections.setup.phoneInstall')}
                        <ChevronDown className={showPhoneDownload ? 'size-4 shrink-0 rotate-180' : 'size-4 shrink-0'} />
                      </Button>
                      <div id={phoneDownloadId} hidden={!showPhoneDownload}>
                        {showPhoneDownload && (
                          <div className="flex flex-wrap items-start gap-4">
                            <div className="w-fit shrink-0 rounded-lg bg-white p-3">
                              <QRCodeSVG
                                value={TAILSCALE_DOWNLOAD}
                                size={112}
                                title={t('deviceConnections.setup.phoneDownload')}
                              />
                            </div>
                            <div className="min-w-0 flex-1 basis-48 space-y-2">
                              <p className="text-foreground">{t('deviceConnections.setup.phoneDownload')}</p>
                              <p className="text-xs">tailscale.com/download</p>
                              <p className="text-xs leading-5">{t('deviceConnections.setup.phone')}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          )}
          <Accordion type="single" collapsible>
            <AccordionItem value="details">
              <AccordionTrigger className="text-start font-normal">
                {t('deviceConnections.setup.details')}
              </AccordionTrigger>
              <AccordionContent className="space-y-4 text-muted-foreground">
                <div className="break-words text-muted-foreground text-xs leading-relaxed">
                  {listeningEndpoint
                    ? t(
                        listeningEndpoint.hosts.includes('0.0.0.0')
                          ? 'deviceConnections.listening.all'
                          : 'deviceConnections.listening.local',
                        {
                          address: listeningEndpoint.hosts
                            .map((host) => `${host.includes(':') ? `[${host}]` : host}:${listeningEndpoint.port}`)
                            .join(' · ')
                        }
                      )
                    : t('deviceConnections.listening.stopped')}
                </div>

                {networks?.map((network) => (
                  <div key={network.product} className="space-y-1 text-xs">
                    <p>
                      {network.product === 'tailscale' ? 'Tailscale' : 'ZeroTier'} · {t(VPN_STATE_KEYS[network.state])}
                    </p>
                    {network.networks.map((item, index) => (
                      <p key={index} className="select-text break-all">
                        {item.name}: {item.hosts.join(', ')}
                      </p>
                    ))}
                  </div>
                ))}
                <div className="space-y-2">
                  {snapshot?.endpoints.map((endpoint) => (
                    <code key={directEndpointUrl(endpoint)} className="block select-text break-all text-xs">
                      {directEndpointUrl(endpoint)}
                    </code>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
        {connectionReady && skill && (
          <Button
            variant="outline"
            className="self-start"
            onClick={() => {
              setOpen(false)
              void launchSkill(skill)
            }}>
            {t('deviceConnections.setup.askAgent')}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
