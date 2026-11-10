import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, Button } from '@cherrystudio/ui'
import type { DoctorController } from '@renderer/hooks/doctor'

type DoctorCheckNoticesController = Pick<DoctorController, 'isInteracting' | 'run'> & {
  readonly session: Pick<DoctorController['session'], 'relaunchRequired'>
  readonly viewModel: Pick<DoctorController['viewModel'], 'isStale' | 'rows' | 'status'>
}

export function DoctorCheckNotices({
  controller,
  onRetry = () => controller.run('quick'),
  retryLabel
}: {
  readonly controller: DoctorCheckNoticesController
  readonly onRetry?: () => void | Promise<void>
  readonly retryLabel?: 'rerun' | 'run_basic'
}) {
  const { t } = useTranslation()
  const { session, viewModel } = controller
  const retryLabelKey =
    retryLabel ?? (viewModel.status === 'canceled' || viewModel.status === 'failed' ? 'rerun' : 'run_basic')
  const retryLabelText = t(
    retryLabelKey === 'rerun' ? 'settings.doctor.actions.rerun' : 'settings.doctor.actions.run_basic'
  )

  return (
    <>
      {viewModel.isStale ? (
        <Alert
          type="warning"
          showIcon
          description={t('settings.doctor.stale.description')}
          action={
            <Button variant="outline" size="sm" disabled={controller.isInteracting} onClick={() => void onRetry()}>
              <RotateCcw className="size-4" aria-hidden />
              {retryLabelText}
            </Button>
          }
        />
      ) : null}

      {session.relaunchRequired ? (
        <Alert type="info" showIcon description={t('settings.doctor.messages.relaunch_required')} />
      ) : null}

      {viewModel.rows.length === 0 ? (
        <Alert
          type="info"
          showIcon
          message={t(
            viewModel.status === 'canceled'
              ? 'settings.doctor.empty.canceled_title'
              : viewModel.status === 'failed'
                ? 'settings.doctor.empty.failed_title'
                : 'settings.doctor.empty.title'
          )}
          description={t(
            viewModel.status === 'canceled'
              ? 'settings.doctor.empty.canceled_description'
              : viewModel.status === 'failed'
                ? 'settings.doctor.empty.failed_description'
                : 'settings.doctor.empty.description'
          )}
          action={
            viewModel.status === 'canceled' || viewModel.status === 'failed' || viewModel.status === 'idle' ? (
              <Button variant="outline" size="sm" disabled={controller.isInteracting} onClick={() => void onRetry()}>
                <RotateCcw className="size-4" aria-hidden />
                {retryLabelText}
              </Button>
            ) : undefined
          }
        />
      ) : null}
    </>
  )
}
