import FileManager from '@renderer/services/FileManager'
import { FileType } from '@renderer/types'
import { isEmpty } from 'lodash'
import { useEffect, useState } from 'react'

import { useKnowledgeBases } from './useKnowledge'

export const useKnowledgeFiles = () => {
  const [knowledgeFiles, setKnowledgeFiles] = useState<FileType[]>([])
  const { bases, updateKnowledgeBases } = useKnowledgeBases()

  useEffect(() => {
    const items = bases.map((kb) => kb.items).flat()

    const fileItems = items
      .filter((item) => item.type === 'file')
      .filter((item) => item.processingStatus === 'completed')

    const files = fileItems.map((item) => item.content as FileType)

    !isEmpty(files) && setKnowledgeFiles(files)
  }, [bases])

  const removeAllFiles = async () => {
    console.debug('removeAllFiles', knowledgeFiles)
    await FileManager.deleteFiles(knowledgeFiles)

    const newBases = bases.map((kb) => ({
      ...kb,
      items: kb.items.map((item) =>
        item.type === 'file'
          ? {
              ...item,
              content: {
                ...(item.content as FileType),
                size: 0
              }
            }
          : item
      )
    }))
    updateKnowledgeBases(newBases)
  }

  const size = knowledgeFiles.reduce((acc, file) => acc + file.size, 0)

  return { knowledgeFiles, size, removeAllFiles }
}
