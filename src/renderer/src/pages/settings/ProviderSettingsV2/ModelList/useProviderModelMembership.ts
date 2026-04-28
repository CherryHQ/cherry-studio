import { useCallback, useState } from 'react'

/**
 * Owns the visibility lifecycle for the provider model membership drawer.
 */
export function useProviderModelMembership() {
  const [membershipOpen, setMembershipOpen] = useState(false)

  const openMembershipDrawer = useCallback(() => {
    setMembershipOpen(true)
  }, [])

  const closeMembershipDrawer = useCallback(() => {
    setMembershipOpen(false)
  }, [])

  return {
    membershipOpen,
    openMembershipDrawer,
    closeMembershipDrawer
  }
}
