// src/config/env.ts
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().url(),
    BASE_URL: z.string().url().default("http://localhost:3000"),
});

export const env = envSchema.parse(process.env);
