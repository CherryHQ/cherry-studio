import { Bell, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneChip, SceneHeader, ScenePanel, SceneRow } from '@cherrystudio/ui'

const SAMPLE_KEYS = [
  'notification.center.empty_scene.sample.backup',
  'notification.center.empty_scene.sample.models',
  'notification.center.empty_scene.sample.update'
] as const

/** No notifications: the notification panel holding only read items, marked all read. */
export function NotificationEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={6}
      sprites={[
        { x: 232, y: 3, color: 1, shape: 'checker', tilt: 10 },
        { x: 8, y: 72, color: 4, shape: 'cross', tilt: -12 },
        { x: 240, y: 118, color: 6, shape: 'ring', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[29px] h-[190px] w-[202px]">
        <SceneHeader
          icon={Bell}
          title={t('notification.center.title')}
          trailing={<SceneChip accent icon={Check} label={t('notification.center.empty_scene.all_read')} />}
        />
        <div className="flex flex-col gap-[4px] px-[8px] pt-[9px]">
          {SAMPLE_KEYS.map((key) => (
            <SceneRow key={key} icon={Check} label={t(key)} muted />
          ))}
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
