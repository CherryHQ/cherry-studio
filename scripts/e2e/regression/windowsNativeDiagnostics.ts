export const WINDOWS_DIAGNOSTIC_RECTANGLE = `@{
  x = $(if ([double]::IsNaN($rect.X) -or [double]::IsInfinity($rect.X)) { $null } else { $rect.X })
  y = $(if ([double]::IsNaN($rect.Y) -or [double]::IsInfinity($rect.Y)) { $null } else { $rect.Y })
  width = $(if ([double]::IsNaN($rect.Width) -or [double]::IsInfinity($rect.Width)) { $null } else { $rect.Width })
  height = $(if ([double]::IsNaN($rect.Height) -or [double]::IsInfinity($rect.Height)) { $null } else { $rect.Height })
}`
