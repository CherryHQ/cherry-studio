import { useNavigate } from '@tanstack/react-router'

import { LaunchpadContent } from '@renderer/components/LaunchpadContent'

export default function LaunchpadPage() {
  const navigate = useNavigate()
  return (
    <LaunchpadContent
      onOpen={(url) => {
        const parsedUrl = new URL(url, 'https://www.cherry-ai.com/')
        void navigate({
          to: parsedUrl.pathname,
          ...(parsedUrl.search ? { search: Object.fromEntries(parsedUrl.searchParams.entries()) } : {})
        })
      }}
    />
  )
}
