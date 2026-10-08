import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'

import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import androidLogo from '@renderer/assets/images/deviceConnections/android.svg'
import iosLogo from '@renderer/assets/images/deviceConnections/ios.svg'
import { ipcApi } from '@renderer/ipc'
import { getAppEdition } from '@renderer/utils/appEdition'

export function MobileAppDownload() {
  const { t } = useTranslation()
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
        getAppEdition() === 'cn'
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
            <Button
              variant="outline"
              className="w-full"
              onClick={() => void ipcApi.request('system.shell.open_external_website', url)}>
              {t(label)}
            </Button>
            {platform === 'ios' && (
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
            )}
          </div>
        </TabsContent>
      ))}
    </Tabs>
  )
}
