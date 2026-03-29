import { useTheme } from '@renderer/context/ThemeProvider'
import { SettingContainer } from '@renderer/pages/settings'
import NpxSearch from '@renderer/pages/settings/MCPSettings/NpxSearch'
import { createFileRoute } from '@tanstack/react-router'

const NpxSearchWrapper = () => {
  const { theme } = useTheme()
  return (
    <SettingContainer theme={theme}>
      <NpxSearch />
    </SettingContainer>
  )
}

export const Route = createFileRoute('/settings/mcp/npx-search')({
  component: NpxSearchWrapper
})
