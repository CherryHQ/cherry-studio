import { AddAgentForm } from '@renderer/types'

export const useAddAgent = () => {
  // const { t } = useTranslation()
  return {
    // oxlint-disable-next-line no-unused-vars
    addAgent: (payload: AddAgentForm) => {
      window.toast.info('Not implemented')
      // window.toast.success(t('common.add_success'))
    }
  }
}
