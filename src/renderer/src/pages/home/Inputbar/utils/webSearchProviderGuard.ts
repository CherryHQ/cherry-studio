type ShouldClearWebSearchProviderParams = {
  hasProviderOverride: boolean
  isMandatoryWebSearchModel: boolean
  isProviderOverridesLoaded: boolean
  isSelectedProviderEnabled: boolean
}

export function shouldClearWebSearchProvider({
  hasProviderOverride,
  isMandatoryWebSearchModel,
  isProviderOverridesLoaded,
  isSelectedProviderEnabled
}: ShouldClearWebSearchProviderParams): boolean {
  if (!hasProviderOverride) {
    return false
  }

  if (isMandatoryWebSearchModel) {
    return true
  }

  return isProviderOverridesLoaded && !isSelectedProviderEnabled
}
