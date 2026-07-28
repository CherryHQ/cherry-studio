import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  out: './migrations/sqlite-drizzle',
  // Recursive + exclude *.test.ts so drizzle-kit never loads vitest-dependent files.
  schema: './src/main/data/db/schemas/**/!(*.test).ts',
  dialect: 'sqlite',
  casing: 'snake_case'
})
