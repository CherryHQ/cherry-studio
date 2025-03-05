import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addSubscribeSource as _addSubscribeSource,
  removeSubscribeSource as _removeSubscribeSource,
  setSubscribeSources as _setSubscribeSources,
  updateSubscribeBlacklist as _updateSubscribeBlacklist
} from '@renderer/store/websearch'
export const useWebSearch = () => {
  const dispatch = useAppDispatch()
  const websearch = useAppSelector((state) => state.websearch)

  const addSubscribeSource = ({ url, name, blacklist }) => {
    dispatch(_addSubscribeSource({ url, name, blacklist }))
  }

  const removeSubscribeSource = (key: number) => {
    dispatch(_removeSubscribeSource(key))
  }

  const updateSubscribeBlacklist = (key: number, blacklist: string[]) => {
    dispatch(_updateSubscribeBlacklist({ key, blacklist }))
  }

  const setSubscribeSources = (sources: { key: number; url: string; name: string; blacklist?: string[] }[]) => {
    dispatch(_setSubscribeSources(sources))
  }

  return {
    websearch,
    addSubscribeSource,
    removeSubscribeSource,
    updateSubscribeBlacklist,
    setSubscribeSources
  }
}
