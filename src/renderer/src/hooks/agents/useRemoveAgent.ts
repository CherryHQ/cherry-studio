// import { useSWRConfig } from 'swr'

export const useRemoveAgent = () => {
  // const { mutate } = useSWRConfig()
  return {
    removeAgent: () => {
      // not implemented
      window.toast.info('Not implemented')
    },
    status: {}
  }
}
