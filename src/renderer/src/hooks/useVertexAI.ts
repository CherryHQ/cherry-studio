import store, { useAppSelector } from '@renderer/store'
import {
  setVertexAILocation,
  setVertexAIProjectId,
  setVertexAIServiceAccountClientEmail,
  setVertexAIServiceAccountPrivateKey
} from '@renderer/store/llm'
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
