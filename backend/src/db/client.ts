import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { loadEnv } from "../env.js";
import * as schema from "./schema.js";

loadEnv();

const queryClient = postgres(process.env.DATABASE_URL!, { max: 8 });
export const db = drizzle(queryClient, { schema });
export { schema };
export const sql = queryClient;
