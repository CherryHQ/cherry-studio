import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  out: './migrations/sqlite-drizzle',
  schema: './src/main/data/db/schemas/*',
  dialect: 'sqlite',
  casing: 'snake_case'
})
