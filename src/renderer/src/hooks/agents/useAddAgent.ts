import { AddAgentForm } from '@renderer/types'

export const useAddAgent = () => {
  return {
    // oxlint-disable-next-line no-unused-vars
    addAgent: (payload: AddAgentForm) => {
      window.toast.info('Not implemented')
    }
  }
}
