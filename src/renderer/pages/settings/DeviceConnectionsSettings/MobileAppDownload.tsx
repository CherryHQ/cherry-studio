import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { Button, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from '@cherrystudio/ui'
import androidLogo from '@renderer/assets/images/deviceConnections/android.svg'
import googlePlayLogo from '@renderer/assets/images/deviceConnections/google-play.png'
import iosLogo from '@renderer/assets/images/deviceConnections/ios.svg'
import { ipcApi } from '@renderer/ipc'
import { getAppEdition } from '@renderer/utils/appEdition'

export function MobileAppDownload() {
  const { t } = useTranslation()
  const edition = getAppEdition()
  const [platform, setPlatform] = useState('ios')
  const {
    data: androidUrl,
    error,
    isValidating,
    mutate
  } = useSWR(
    platform === 'android' ? 'app.mobile.get_android_download_url' : null,
    () => ipcApi.request('app.mobile.get_android_download_url'),
    { shouldRetryOnError: false }
  )
  const mobileDownloads = [
    {
      platform: 'ios',
      name: 'deviceConnections.download.platform.ios',
      label: 'deviceConnections.download.ios',
      logo: iosLogo,
      url: 'https://apps.apple.com/app/id6809783714'
    },
    {
      platform: 'android',
      name: 'deviceConnections.download.platform.android',
      label: 'deviceConnections.download.android',
      logo: androidLogo,
      url: androidUrl
    }
  ] as const

  return (
    <Tabs value={platform} onValueChange={setPlatform} className="items-center gap-6">
      <TabsList className="w-64">
        {mobileDownloads.map(({ platform, name, logo }) => (
          <TabsTrigger key={platform} value={platform}>
            <img src={logo} alt="" className="size-4" />
            {t(name)}
          </TabsTrigger>
        ))}
      </TabsList>
      {mobileDownloads.map(({ platform, label, url }) => (
        <TabsContent key={platform} value={platform} className="w-64">
          <div className="flex flex-col items-center gap-4">
            {url ? (
              <div className="rounded-xl border border-border bg-white p-3">
                <QRCodeSVG value={url} size={176} title={t(label)} />
              </div>
            ) : (
              <div className="flex size-[202px] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                {error && !isValidating ? (
                  <>
                    <p role="alert">{t('deviceConnections.download.loadFailed')}</p>
                    <Button variant="outline" size="sm" onClick={() => void mutate()}>
                      {t('common.retry')}
                    </Button>
                  </>
                ) : (
                  <div role="status">
                    <Spinner text={t('common.loading')} />
                  </div>
                )}
              </div>
            )}
            {platform === 'android' && (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <span>{t(url ? 'deviceConnections.download.scanApk' : label)}</span>
                {edition === 'global' && (
                  <>
                    <span aria-hidden="true" className="h-3 border-s border-border" />
                    <Tooltip content={t('deviceConnections.download.googlePlay')} asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('deviceConnections.download.googlePlay')}
                        onClick={() =>
                          void ipcApi.request(
                            'system.shell.open_external_website',
                            'https://play.google.com/store/apps/details?id=com.cherryai.cherrystudio_app'
                          )
                        }>
                        <img src={googlePlayLogo} alt="" className="size-4" />
                      </Button>
                    </Tooltip>
                  </>
                )}
              </div>
            )}
            {platform === 'ios' && url && (
              <>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => void ipcApi.request('system.shell.open_external_website', url)}>
                  {t(label)}
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  className="text-muted-foreground shadow-none"
                  onClick={() =>
                    void ipcApi.request(
                      'system.shell.open_external_website',
                      'https://testflight.apple.com/join/2ryzjB66'
                    )
                  }>
                  {t('deviceConnections.download.testFlight')}
                </Button>
              </>
            )}
          </div>
        </TabsContent>
      ))}
    </Tabs>
  )
}
