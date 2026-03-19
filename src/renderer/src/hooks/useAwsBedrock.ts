import store, { useAppSelector } from '@renderer/store'
import {
  setAwsBedrockAccessKeyId,
  setAwsBedrockApiKey,
  setAwsBedrockAuthType,
  setAwsBedrockRegion,
  setAwsBedrockSecretAccessKey,
  setAwsBedrockSSOAccountId,
  setAwsBedrockSSORegion,
  setAwsBedrockSSORoleName,
  setAwsBedrockSSOStartUrl
} from '@renderer/store/llm'
import type { AwsBedrockAuthType } from '@renderer/types'
import { useDispatch } from 'react-redux'

export function useAwsBedrockSettings() {
  const settings = useAppSelector((state) => state.llm.settings.awsBedrock)
  const dispatch = useDispatch()

  return {
    ...settings,
    setAuthType: (authType: AwsBedrockAuthType) => dispatch(setAwsBedrockAuthType(authType)),
    setAccessKeyId: (accessKeyId: string) => dispatch(setAwsBedrockAccessKeyId(accessKeyId)),
    setSecretAccessKey: (secretAccessKey: string) => dispatch(setAwsBedrockSecretAccessKey(secretAccessKey)),
    setApiKey: (apiKey: string) => dispatch(setAwsBedrockApiKey(apiKey)),
    setRegion: (region: string) => dispatch(setAwsBedrockRegion(region)),
    setSSOStartUrl: (url: string) => dispatch(setAwsBedrockSSOStartUrl(url)),
    setSSORegion: (region: string) => dispatch(setAwsBedrockSSORegion(region)),
    setSSOAccountId: (accountId: string) => dispatch(setAwsBedrockSSOAccountId(accountId)),
    setSSORoleName: (roleName: string) => dispatch(setAwsBedrockSSORoleName(roleName))
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

export function getAwsBedrockSSOConfig() {
  const settings = store.getState().llm.settings.awsBedrock
  return {
    startUrl: settings.ssoStartUrl,
    ssoRegion: settings.ssoRegion,
    accountId: settings.ssoAccountId,
    roleName: settings.ssoRoleName
  }
}

export function getAwsBedrockSSOCredentialProvider() {
  return async () => {
    const config = getAwsBedrockSSOConfig()
    const creds = await window.api.awsBedrock.resolveSSOCredentials(config)
    return {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
      expiration: creds.expiration ? new Date(creds.expiration) : undefined
    }
  }
}
