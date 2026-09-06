import { Alert, Button } from '@cherrystudio/ui'
import type { DoctorController } from '@renderer/hooks/doctor'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type DoctorCheckNoticesController = Pick<DoctorController, 'isInteracting' | 'run'> & {
  readonly session: Pick<DoctorController['session'], 'relaunchRequired'>
  readonly viewModel: Pick<DoctorController['viewModel'], 'isStale' | 'rows' | 'status'>
}

export function DoctorCheckNotices({ controller }: { readonly controller: DoctorCheckNoticesController }) {
  const { t } = useTranslation()
  const { session, viewModel } = controller

  return (
    <>
      {viewModel.isStale ? (
        <Alert
          type="warning"
          showIcon
          description={t('settings.doctor.stale.description')}
          action={
            <Button
              variant="outline"
              size="sm"
              disabled={controller.isInteracting}
              onClick={() => void controller.run('quick')}>
              <RotateCcw className="size-4" aria-hidden />
              {t('settings.doctor.actions.run_basic')}
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
            viewModel.status === 'canceled' ? 'settings.doctor.empty.canceled_title' : 'settings.doctor.empty.title'
          )}
          description={t(
            viewModel.status === 'canceled'
              ? 'settings.doctor.empty.canceled_description'
              : 'settings.doctor.empty.description'
          )}
          action={
            viewModel.status === 'canceled' ? (
              <Button
                variant="outline"
                size="sm"
                disabled={controller.isInteracting}
                onClick={() => void controller.run('quick')}>
                <RotateCcw className="size-4" aria-hidden />
                {t('settings.doctor.actions.rerun')}
              </Button>
            ) : undefined
          }
        />
      ) : null}
    </>
  )
}
