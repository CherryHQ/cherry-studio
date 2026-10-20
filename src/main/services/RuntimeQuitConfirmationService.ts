import { dialog } from 'electron'

import { application } from '@application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { t } from '@main/i18n'

@Injectable('RuntimeQuitConfirmationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['RuntimeActivityService'])
export class RuntimeQuitConfirmationService extends BaseService {
  protected onInit(): void {
    this.registerDisposable(
      application.registerQuitGuard(() => {
        if (!application.get('RuntimeActivityService').hasActiveTasks()) return true
        return this.confirmInterruptAndQuit()
      })
    )
  }

  private async confirmInterruptAndQuit(): Promise<boolean> {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: t('dialog.quit_active_tasks.title'),
      message: t('dialog.quit_active_tasks.message'),
      detail: t('dialog.quit_active_tasks.detail'),
      buttons: [t('dialog.quit_active_tasks.continue'), t('dialog.quit_active_tasks.quit')],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    return response === 1
  }
}
