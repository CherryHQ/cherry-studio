import { usePreference } from '@data/hooks/usePreference'

export const useNavbarPosition = () => {
  const [navbarPosition, setNavbarPosition] = usePreference('ui.navbar.position')

  return {
    navbarPosition,
    isLeftNavbar: navbarPosition === 'left',
    isTopNavbar: navbarPosition === 'top',
    setNavbarPosition: (position: 'left' | 'top') => setNavbarPosition(position)
  }
}
