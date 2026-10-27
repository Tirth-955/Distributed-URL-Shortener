import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env.js";

export const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
});

export const db = drizzle(pool);
