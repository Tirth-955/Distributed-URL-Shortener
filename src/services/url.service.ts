import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { urls } from "../db/schema.js";
import { generateShortCode } from "../utils/generate-short-code.js";

export async function createShortUrl(originalUrl: string, expiresInDays?: number) {
    const expiresAt =
        expiresInDays === undefined
            ? null
            : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    for (let attempt = 0; attempt < 3; attempt++) {
        const shortCode = generateShortCode();

        try {
            await db.insert(urls).values({
                shortCode,
                originalUrl,
                expiresAt,
            });

            return { shortCode, originalUrl, expiresAt };
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

export async function getUrlByShortCode(shortCode: string) {
    const [url] = await db.select().from(urls).where(eq(urls.shortCode, shortCode)).limit(1);

    if (!url) {
        return { status: "not_found" as const };
    }

    if (!url.isActive) {
        return { status: "not_found" as const };
    }

    if (url.expiresAt && url.expiresAt.getTime() <= Date.now()) {
        return { status: "expired" as const };
    }

    return {
        status: "found" as const,
        originalUrl: url.originalUrl,
    };
}
