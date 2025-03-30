import MinappPopupContainer from '@renderer/components/MinApp/MinappPopupContainer'
import { useRuntime } from '@renderer/hooks/useRuntime'

const TopViewMinappContainer = () => {
  const { openedKeepAliveMinapps, openedOneOffMinapp } = useRuntime()
  const isCreate = openedKeepAliveMinapps.length > 0 || openedOneOffMinapp !== null

  return <>{isCreate && <MinappPopupContainer />}</>
}

export default TopViewMinappContainer
