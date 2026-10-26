import { db } from "../db/index.js";
import { urls } from "../db/schema.js";
import { generateShortCode } from "../utils/generate-short-code.js";

export async function createShortUrl(originalUrl: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const shortCode = generateShortCode();

        try {
            await db.insert(urls).values({
                shortCode,
                originalUrl,
            });

            return { shortCode, originalUrl };
        } catch (error: unknown) {
            const isUniqueViolation =
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                error.code === "23505";

            if (!isUniqueViolation || attempt === 2) {
                throw error;
            }
        }
    }

    throw new Error("Unable to generate a unique short code");
}
