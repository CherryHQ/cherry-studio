import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { AlertCircle } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'

export interface ModelDetectionLeavePopupParams {
  count: number
  phase: 'detected' | 'detecting'
}

export type ModelDetectionLeaveDecision = 'leave' | 'stay'

type Props = ModelDetectionLeavePopupParams & PopupInjectedProps<ModelDetectionLeaveDecision>

const PopupContainer: React.FC<Props> = ({ count, open, phase, resolve }) => {
  const { t } = useTranslation()
  const isDetecting = phase === 'detecting'

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resolve('stay')
        }
      }}>
      <DialogContent showCloseButton={false} overlayClassName="z-[90]" className="z-[90] gap-5">
        <DialogHeader className="gap-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base leading-6">
                {isDetecting
                  ? t('settings.models.auto_detect.leave_detecting_title')
                  : t('settings.models.auto_detect.leave_detected_title', { count })}
              </DialogTitle>
              <DialogDescription className="wrap-anywhere mt-2 min-w-0 max-w-full text-sm leading-5">
                {isDetecting
                  ? t('settings.models.auto_detect.leave_detecting')
                  : t('settings.models.auto_detect.leave_detected')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={() => resolve('leave')}>
            {t('settings.models.auto_detect.leave_anyway')}
          </Button>
          <Button variant="emphasis" onClick={() => resolve('stay')}>
            {isDetecting
              ? t('settings.models.auto_detect.stay_detecting')
              : t('settings.models.auto_detect.stay_detected')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const ModelDetectionLeavePopup = createPopup<ModelDetectionLeavePopupParams, ModelDetectionLeaveDecision>(
  PopupContainer,
  { dismissResult: 'stay' }
)

export default ModelDetectionLeavePopup
