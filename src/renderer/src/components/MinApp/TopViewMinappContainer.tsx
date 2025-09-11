import MinappPopupContainer from '@renderer/components/MinApp/MinappPopupContainer'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition } from '@renderer/hooks/useSettings'

const TopViewMinappContainer = () => {
  const { openedKeepAliveMinapps, openedOneOffMinapp } = useRuntime()
  const { isLeftNavbar } = useNavbarPosition()
  const isCreate = openedKeepAliveMinapps.length > 0 || openedOneOffMinapp !== null

  // Only show popup container in sidebar mode (left navbar), not in tab mode (top navbar)
  return <>{isCreate && isLeftNavbar && <MinappPopupContainer />}</>
}

export default TopViewMinappContainer
