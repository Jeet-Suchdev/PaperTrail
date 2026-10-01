import { defineConfig, env } from 'prisma/config';
import 'dotenv/config';

// Prisma 7 config (this filename is what prisma@7.10+ generates; the CLI also
// accepts prisma.config.ts). The datasource URL lives here, not in schema.prisma.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
