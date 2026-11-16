import { ErrorDetailLink } from '@renderer/components/ErrorDetailLink'
import { useErrorDetailOpener } from '@renderer/hooks/useErrorDetailOpener'
import type { InlineErrorDetailInput } from '@renderer/services/AppErrorDetailService'

export function ErrorDetailAction(props: InlineErrorDetailInput) {
  return <ErrorDetailLink onClick={useErrorDetailOpener(props)} />
}
