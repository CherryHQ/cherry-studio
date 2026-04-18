import MiniAppPopupContainer from '@renderer/components/MiniApp/MiniAppPopupContainer'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'

const TopViewMiniAppContainer = () => {
  const { openedKeepAliveMiniApps, openedOneOffMiniApp } = useMiniApps()
  const { isLeftNavbar } = useNavbarPosition()
  const isCreate = openedKeepAliveMiniApps.length > 0 || openedOneOffMiniApp !== null

  // Only show popup container in sidebar mode (left navbar), not in tab mode (top navbar)
  return <>{isCreate && isLeftNavbar && <MiniAppPopupContainer />}</>
}

export default TopViewMiniAppContainer
