import { UpdateAgentForm } from '@renderer/types'

export const useUpdateAgent = () => {
  return {
    // oxlint-disable-next-line no-unused-vars
    updateAgent: (payload: UpdateAgentForm) => {
      window.toast.info('Not implemented')
      // window.toast.success(t('common.update_success'))
    }
  }
}
