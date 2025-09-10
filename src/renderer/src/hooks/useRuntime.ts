import i18n from '@renderer/i18n'
import store, { useAppSelector } from '@renderer/store'

export function useRuntime() {
  return useAppSelector((state) => state.runtime)
}

export function modelGenerating() {
  const generating = store.getState().runtime.generating

  if (generating) {
    window.toast.warning(i18n.t('message.switch.disabled'))
    return Promise.reject()
  }

  return Promise.resolve()
}
