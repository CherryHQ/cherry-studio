import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { type FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import PaintingPage from '../paintings'
import { paintingClasses } from '../paintings/paintingPrimitives'
import VideoPage from './video/VideoPage'

type CreationTab = 'image' | 'video'

/**
 * Unified Creation page: an Image | Video tab shell. The Image tab hosts the
 * existing painting page unchanged; the Video tab hosts the new `VideoPage`.
 * Both already render a full-height `paintingClasses.page` layout, so this
 * shell only adds the top tab bar and fills the remaining height. Inactive
 * tabs unmount (Radix default), which lets the painting page run its
 * save-on-unmount effect when the user switches away.
 */
const CreationPage: FC = () => {
  const { t } = useTranslation()
  const [tab, setTab] = useState<CreationTab>('image')

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as CreationTab)} className="flex h-full flex-1 flex-col">
      <div className={paintingClasses.tabsWrap}>
        <TabsList className={paintingClasses.tabsList}>
          <TabsTrigger value="image" className={paintingClasses.tabsTrigger}>
            {t('paintings.title')}
          </TabsTrigger>
          <TabsTrigger value="video" className={paintingClasses.tabsTrigger}>
            {t('paintings.video.title')}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="image" className="min-h-0 flex-1 focus-visible:outline-none">
        <PaintingPage />
      </TabsContent>
      <TabsContent value="video" className="min-h-0 flex-1 focus-visible:outline-none">
        <VideoPage />
      </TabsContent>
    </Tabs>
  )
}

export default CreationPage
