import store, { useAppSelector } from '@renderer/store'
import { setAwsBedrockAccessKeyId, setAwsBedrockRegion, setAwsBedrockSecretAccessKey } from '@renderer/store/llm'
import { useDispatch } from 'react-redux'

export function useAwsBedrockSettings() {
  const settings = useAppSelector((state) => state.llm.settings.awsBedrock)
  const dispatch = useDispatch()

  return {
    ...settings,
    setAccessKeyId: (accessKeyId: string) => dispatch(setAwsBedrockAccessKeyId(accessKeyId)),
    setSecretAccessKey: (secretAccessKey: string) => dispatch(setAwsBedrockSecretAccessKey(secretAccessKey)),
    setRegion: (region: string) => dispatch(setAwsBedrockRegion(region))
  }
}

export function getAwsBedrockSettings() {
  return store.getState().llm.settings.awsBedrock
}

export function getAwsBedrockAccessKeyId() {
  return store.getState().llm.settings.awsBedrock.accessKeyId
}

export function getAwsBedrockSecretAccessKey() {
  return store.getState().llm.settings.awsBedrock.secretAccessKey
}

export function getAwsBedrockRegion() {
  return store.getState().llm.settings.awsBedrock.region
}
