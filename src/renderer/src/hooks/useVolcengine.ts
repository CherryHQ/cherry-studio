import store, { useAppSelector } from '@renderer/store'
import { setVolcengineProjectName, setVolcengineRegion } from '@renderer/store/llm'
import { useDispatch } from 'react-redux'

export function useVolcengineSettings() {
  const settings = useAppSelector((state) => state.llm.settings.volcengine)
  const dispatch = useDispatch()

  return {
    ...settings,
    setRegion: (region: string) => dispatch(setVolcengineRegion(region)),
    setProjectName: (projectName: string) => dispatch(setVolcengineProjectName(projectName))
  }
}

export function getVolcengineSettings() {
  return store.getState().llm.settings.volcengine
}

export function getVolcengineRegion() {
  return store.getState().llm.settings.volcengine.region
}

export function getVolcengineProjectName() {
  return store.getState().llm.settings.volcengine.projectName
}
