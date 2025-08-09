import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { Calculator } from 'lucide-react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import PlaceholderBlock from './PlaceholderBlock'

const MathPlaceholderNodeView: React.FC<NodeViewProps> = ({ node, deleteNode, editor }) => {
  const { t } = useTranslation()

  const handleClick = useCallback(() => {
    let hasCreatedMath = false
    const mathType = node.attrs.mathType || 'block'

    const event = new CustomEvent('openMathDialog', {
      detail: {
        defaultValue: '',
        onSubmit: (latex: string) => {
          // onFormulaChange has already handled the creation/update
          // onSubmit just needs to close the dialog
          // Only delete if input is empty
          if (!latex.trim()) {
            deleteNode()
          }
        },
        onCancel: () => deleteNode(),
        onFormulaChange: (formula: string) => {
          if (formula.trim()) {
            if (!hasCreatedMath) {
              hasCreatedMath = true
              deleteNode()
              if (mathType === 'block') {
                editor.chain().insertBlockMath({ latex: formula }).run()
              } else {
                editor.chain().insertInlineMath({ latex: formula }).run()
              }
            } else {
              if (mathType === 'block') {
                editor.chain().updateBlockMath({ latex: formula }).run()
              } else {
                editor.chain().updateInlineMath({ latex: formula }).run()
              }
            }
          }
        }
      }
    })
    window.dispatchEvent(event)
  }, [node.attrs.mathType, deleteNode, editor])

  return (
    <NodeViewWrapper className="math-placeholder-wrapper">
      <PlaceholderBlock
        icon={<Calculator size={20} style={{ color: '#656d76' }} />}
        message={t('richEditor.math.placeholder')}
        onClick={handleClick}
      />
    </NodeViewWrapper>
  )
}

export default MathPlaceholderNodeView
