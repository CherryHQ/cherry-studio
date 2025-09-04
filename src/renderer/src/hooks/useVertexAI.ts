import store, { useAppSelector } from '@renderer/store'
import {
  setVertexAILocation,
  setVertexAIProjectId,
  setVertexAIServiceAccountClientEmail,
  setVertexAIServiceAccountPrivateKey
} from '@renderer/store/llm'
import { Provider, VertexProvider } from '@renderer/types'
import { useDispatch } from 'react-redux'

export function useVertexAISettings() {
  const settings = useAppSelector((state) => state.llm.settings.vertexai)
  const dispatch = useDispatch()

  return {
    ...settings,
    setProjectId: (projectId: string) => dispatch(setVertexAIProjectId(projectId)),
    setLocation: (location: string) => dispatch(setVertexAILocation(location)),
    setServiceAccountPrivateKey: (privateKey: string) => dispatch(setVertexAIServiceAccountPrivateKey(privateKey)),
    setServiceAccountClientEmail: (clientEmail: string) => dispatch(setVertexAIServiceAccountClientEmail(clientEmail))
  }
}

// FIXME: 这些redux设置状态被服务层使用，这是不应该的。
export function getVertexAISettings() {
  return store.getState().llm.settings.vertexai
}

export function getVertexAILocation() {
  return store.getState().llm.settings.vertexai.location
}

export function getVertexAIProjectId() {
  return store.getState().llm.settings.vertexai.projectId
}

export function getVertexAIServiceAccount() {
  return store.getState().llm.settings.vertexai.serviceAccount
}

/**
 * 类型守卫：检查 Provider 是否为 VertexProvider
 */
export function isVertexProvider(provider: Provider): provider is VertexProvider {
  return provider.type === 'vertexai' && 'googleCredentials' in provider
}

/**
 * 创建 VertexProvider 对象，整合单独的配置
 * @param baseProvider 基础的 provider 配置
 * @returns VertexProvider 对象
 */
export function createVertexProvider(baseProvider: Provider): VertexProvider {
  const settings = getVertexAISettings()

  return {
    ...baseProvider,
    type: 'vertexai' as const,
    googleCredentials: {
      clientEmail: settings.serviceAccount.clientEmail,
      privateKey: settings.serviceAccount.privateKey
    },
    project: settings.projectId,
    location: settings.location
  }
}

/**
 * 检查 VertexAI 配置是否完整
 */
export function isVertexAIConfigured(): boolean {
  const settings = getVertexAISettings()
  return !!(
    settings.serviceAccount.clientEmail &&
    settings.serviceAccount.privateKey &&
    settings.projectId &&
    settings.location
  )
}
