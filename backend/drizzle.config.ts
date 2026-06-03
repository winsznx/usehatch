import type { Config } from "drizzle-kit";
process.loadEnvFile(new URL("./.env", import.meta.url));

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config;
