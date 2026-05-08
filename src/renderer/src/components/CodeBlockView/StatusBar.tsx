import { Flex } from '@cherrystudio/ui'
import type { FC, ReactNode } from 'react'
import { memo } from 'react'

interface Props {
  children: string | ReactNode
}

const StatusBar: FC<Props> = ({ children }) => {
  return <Flex className="flex-col gap-2 overflow-y-auto rounded-b-lg bg-muted p-3 [text-wrap:wrap]">{children}</Flex>
}

export default memo(StatusBar)
