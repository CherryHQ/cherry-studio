const isImport = (node) => node?.type === 'ImportDeclaration' || node?.type === 'TSImportEqualsDeclaration'

export default {
  meta: { name: 'import-layout' },
  rules: {
    'no-block-comments-between-imports': {
      meta: {
        type: 'layout',
        schema: [],
        messages: { misplaced: 'Keep block comments outside the import group. Put file documentation before imports.' }
      },
      create(context) {
        return {
          Program(node) {
            for (let index = 1; index < node.body.length; index++) {
              const previous = node.body[index - 1]
              const current = node.body[index]
              if (!isImport(previous) || !isImport(current)) continue
              for (const comment of context.sourceCode.getCommentsBefore(current)) {
                if (comment.type === 'Block' && comment.range[0] >= previous.range[1]) {
                  context.report({ loc: comment.loc, messageId: 'misplaced' })
                }
              }
            }
          }
        }
      }
    }
  }
}
