import store, { useAppSelector } from '@renderer/store'
import { setGPUStackKeepAliveTime } from '@renderer/store/llm'
import { useDispatch } from 'react-redux'

export function useGpuStackSettings() {
  const settings = useAppSelector((state) => state.llm.settings.gpustack)
  const dispatch = useDispatch()

  return { ...settings, setKeepAliveTime: (time: number) => dispatch(setGPUStackKeepAliveTime(time)) }
}

export function getGpuStackSettings() {
  return store.getState().llm.settings.gpustack
}

export function getGPUStackKeepAliveTime() {
  return store.getState().llm.settings.gpustack.keepAliveTime + 'm'
}
