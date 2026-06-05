import { useTheme } from '@renderer/context/ThemeProvider'
import { SettingsContentColumn } from '@renderer/pages/settings'
import NpxSearch from '@renderer/pages/settings/McpSettings/NpxSearch'
import { createFileRoute } from '@tanstack/react-router'

const NpxSearchWrapper = () => {
  const { theme } = useTheme()
  return (
    <SettingsContentColumn theme={theme} innerClassName="max-w-[1200px]">
      <NpxSearch />
    </SettingsContentColumn>
  )
}

export const Route = createFileRoute('/settings/mcp/npx-search')({
  component: NpxSearchWrapper
})
