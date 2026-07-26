import type { FC } from 'react'

import LogoAvatar from './LogoAvatar'
import { getMiniAppsLogoRef, useMiniAppLogo } from './miniAppsLogo'

interface Props {
  /** Mini-app logo field: a known logo id (brand icon) or an image URL/path. */
  logo: string | undefined
  size?: number
  className?: string
}

/**
 * LogoAvatar for a mini-app logo field. Known ids branch synchronously to the
 * brand icon path (with a size-stable placeholder while the icon chunk loads);
 * anything else renders as an image URL via LogoAvatar's string path.
 */
const MiniAppLogoAvatar: FC<Props> = ({ logo, size = 32, className }) => {
  const logoRef = getMiniAppsLogoRef(logo)
  const Icon = useMiniAppLogo(logo)
  if (logoRef && !Icon) {
    return <span className="inline-block shrink-0" style={{ width: size, height: size }} />
  }
  return <LogoAvatar logo={Icon ?? logo} size={size} className={className} />
}

export default MiniAppLogoAvatar
