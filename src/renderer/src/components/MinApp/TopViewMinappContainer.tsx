import MinappPopupContainer from '@renderer/components/MinApp/MinappPopupContainer'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'

const TopViewMinappContainer = () => {
  const { openedKeepAliveMinapps, openedOneOffMinapp } = useMinapps()
  const { isLeftNavbar } = useNavbarPosition()
  const isCreate = openedKeepAliveMinapps.length > 0 || openedOneOffMinapp !== null

  // Only show popup container in sidebar mode (left navbar), not in tab mode (top navbar)
  return <>{isCreate && isLeftNavbar && <MinappPopupContainer />}</>
}

export default TopViewMinappContainer
