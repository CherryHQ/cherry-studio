import i18n from '@renderer/i18n'
import store, { useAppSelector } from '@renderer/store'

export function useRuntime() {
  return useAppSelector((state) => state.runtime)
}

export function useResizeValue(key: string) {
  return useAppSelector((state) => state.runtime.resizeValue[key])
}

export function modelGenerating() {
  const generating = store.getState().runtime.generating

  if (generating) {
    window.message.warning({ content: i18n.t('message.switch.disabled'), key: 'model-generating' })
    return Promise.reject()
  }

  return Promise.resolve()
}
