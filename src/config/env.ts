import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().min(1),
    BASE_URL: z.string().url().default("http://localhost:3000"),
    REDIS_URL: z.string().url(),
});

export const env = envSchema.parse(process.env);
