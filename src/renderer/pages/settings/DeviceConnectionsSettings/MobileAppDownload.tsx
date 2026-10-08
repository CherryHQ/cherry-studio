import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'

import { Button, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from '@cherrystudio/ui'
import androidLogo from '@renderer/assets/images/deviceConnections/android.svg'
import googlePlayLogo from '@renderer/assets/images/deviceConnections/google-play.png'
import iosLogo from '@renderer/assets/images/deviceConnections/ios.svg'
import { ipcApi } from '@renderer/ipc'
import { getAppEdition } from '@renderer/utils/appEdition'

export function MobileAppDownload() {
  const { t } = useTranslation()
  const edition = getAppEdition()
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
      url:
        edition === 'cn'
          ? 'https://gitcode.com/CherryHQ/cherry-studio-app/releases/download/v0.1.1/cherry-studio-0.1.1-android.apk'
          : 'https://github.com/CherryHQ/cherry-studio-app/releases/download/v0.1.1/cherry-studio-0.1.1-android.apk'
    }
  ] as const

  return (
    <Tabs defaultValue="ios" className="items-center gap-6">
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
            <div className="rounded-xl border border-border bg-white p-3">
              <QRCodeSVG value={url} size={176} title={t(label)} />
            </div>
            {platform === 'ios' && (
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
            {platform === 'android' && edition === 'global' && (
              <Tooltip content={t('deviceConnections.download.googlePlay')} asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('deviceConnections.download.googlePlay')}
                  onClick={() =>
                    void ipcApi.request(
                      'system.shell.open_external_website',
                      'https://play.google.com/store/apps/details?id=com.cherryai.cherrystudio_app'
                    )
                  }>
                  <img src={googlePlayLogo} alt="" className="size-6" />
                </Button>
              </Tooltip>
            )}
          </div>
        </TabsContent>
      ))}
    </Tabs>
  )
}
