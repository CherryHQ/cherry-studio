import store, { useAppSelector } from '@renderer/store'
import {
  setAwsBedrockAccessKeyId,
  setAwsBedrockApiKey,
  setAwsBedrockAuthType,
  setAwsBedrockRegion,
  setAwsBedrockSecretAccessKey
} from '@renderer/store/llm'
import { useDispatch } from 'react-redux'

export function useAwsBedrockSettings() {
  const settings = useAppSelector((state) => state.llm.settings.awsBedrock)
  const dispatch = useDispatch()

  return {
    ...settings,
    setAuthType: (authType: 'iam' | 'apiKey') => dispatch(setAwsBedrockAuthType(authType)),
    setAccessKeyId: (accessKeyId: string) => dispatch(setAwsBedrockAccessKeyId(accessKeyId)),
    setSecretAccessKey: (secretAccessKey: string) => dispatch(setAwsBedrockSecretAccessKey(secretAccessKey)),
    setApiKey: (apiKey: string) => dispatch(setAwsBedrockApiKey(apiKey)),
    setRegion: (region: string) => dispatch(setAwsBedrockRegion(region))
  }
}

export function getAwsBedrockSettings() {
  return store.getState().llm.settings.awsBedrock
}

export function getAwsBedrockAuthType() {
  return store.getState().llm.settings.awsBedrock.authType
}

export function getAwsBedrockAccessKeyId() {
  return store.getState().llm.settings.awsBedrock.accessKeyId
}

export function getAwsBedrockSecretAccessKey() {
  return store.getState().llm.settings.awsBedrock.secretAccessKey
}

export function getAwsBedrockApiKey() {
  return store.getState().llm.settings.awsBedrock.apiKey
}

export function getAwsBedrockRegion() {
  return store.getState().llm.settings.awsBedrock.region
}
