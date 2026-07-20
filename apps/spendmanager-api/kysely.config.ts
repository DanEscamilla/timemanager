import { defineConfig } from "kysely-ctl";
import { db } from './src/db/database.ts';

export default defineConfig({
  destroyOnExit: true,
  kysely: db,
  migrations: {
    migrationFolder: './src/db/migrations',
  },
});
