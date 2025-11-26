import store, { useAppSelector } from '@renderer/store'
import { setVolcengineAccessKeyId, setVolcengineRegion, setVolcengineSecretAccessKey } from '@renderer/store/llm'
import { useDispatch } from 'react-redux'

export function useVolcengineSettings() {
  const settings = useAppSelector((state) => state.llm.settings.volcengine)
  const dispatch = useDispatch()

  return {
    ...settings,
    setAccessKeyId: (accessKeyId: string) => dispatch(setVolcengineAccessKeyId(accessKeyId)),
    setSecretAccessKey: (secretAccessKey: string) => dispatch(setVolcengineSecretAccessKey(secretAccessKey)),
    setRegion: (region: string) => dispatch(setVolcengineRegion(region))
  }
}

export function getVolcengineSettings() {
  return store.getState().llm.settings.volcengine
}

export function getVolcengineAccessKeyId() {
  return store.getState().llm.settings.volcengine.accessKeyId
}

export function getVolcengineSecretAccessKey() {
  return store.getState().llm.settings.volcengine.secretAccessKey
}

export function getVolcengineRegion() {
  return store.getState().llm.settings.volcengine.region
}
