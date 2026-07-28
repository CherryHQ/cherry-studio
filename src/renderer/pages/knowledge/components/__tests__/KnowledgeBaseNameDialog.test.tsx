import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeBaseNameDialog from '../KnowledgeBaseNameDialog'

const mockKnowledgeEntityNameDialog = vi.fn()

vi.mock('../KnowledgeEntityNameDialog', () => ({
  default: (props: unknown) => {
    mockKnowledgeEntityNameDialog(props)
    return null
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.name': '名称',
          'knowledge.context.rename': '重命名',
          'knowledge.error.failed_to_edit': '知识库编辑失败',
          'knowledge.name_required': '知识库名称为必填项',
          'knowledge.rename_title': '重命名知识库'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

describe('KnowledgeBaseNameDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the required rename-only props into KnowledgeEntityNameDialog', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()

    render(
      <KnowledgeBaseNameDialog
        open
        initialName="Research"
        isSubmitting={false}
        onSubmit={onSubmit}
        onOpenChange={onOpenChange}
      />
    )

    expect(mockKnowledgeEntityNameDialog).toHaveBeenCalledWith({
      open: true,
      title: '重命名知识库',
      submitLabel: '重命名',
      initialName: 'Research',
      isSubmitting: false,
      submitErrorMessage: '知识库编辑失败',
      namePlaceholder: '名称',
      nameRequiredMessage: '知识库名称为必填项',
      onSubmit,
      onOpenChange
    })
  })
})
