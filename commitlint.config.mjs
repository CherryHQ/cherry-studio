const allowedTypes = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'hotfix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test'
]

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', allowedTypes],
    'scope-case': [2, 'always', 'kebab-case'],
    'subject-empty': [2, 'never'],
    'header-max-length': [2, 'always', 100],
    'breaking-change-exclamation-mark': [2, 'always']
  }
}
