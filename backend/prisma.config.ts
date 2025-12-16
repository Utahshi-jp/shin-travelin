import { config } from "dotenv";
import { join } from "path";
import { defineConfig, env } from "prisma/config";

config({ path: join(process.cwd(), ".env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
