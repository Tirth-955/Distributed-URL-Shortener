import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { urls } from "../db/schema.js";
import { ShortCodeTakenError } from "../utils/errors.js";
import { generateShortCode } from "../utils/generate-short-code.js";
import { cacheUrl, getCachedUrl, invalidateCachedUrl } from "./url-cache.service.js";

const RESERVED_SHORT_CODES = new Set(["health", "api", "urls"]);
const RANDOM_CODE_ATTEMPTS = 3;

export type CreateShortUrlInput = {
    originalUrl: string;
    expiresInDays?: number;
    customCode?: string;
};

export async function createShortUrl(input: CreateShortUrlInput) {
    const expiresAt =
        input.expiresInDays === undefined
            ? null
            : new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);

    if (input.customCode) {
        if (RESERVED_SHORT_CODES.has(input.customCode.toLowerCase())) {
            throw new ShortCodeTakenError(input.customCode);
        }

        try {
            await db.insert(urls).values({
                shortCode: input.customCode,
                originalUrl: input.originalUrl,
                expiresAt,
            });

            return { shortCode: input.customCode, originalUrl: input.originalUrl, expiresAt };
        } catch (error: unknown) {
            if (isUniqueViolation(error)) {
                throw new ShortCodeTakenError(input.customCode);
            }

            throw error;
        }
    }

    for (let attempt = 0; attempt < RANDOM_CODE_ATTEMPTS; attempt++) {
        const shortCode = generateShortCode();

        try {
            await db.insert(urls).values({
                shortCode,
                originalUrl: input.originalUrl,
                expiresAt,
            });

            return { shortCode, originalUrl: input.originalUrl, expiresAt };
        } catch (error: unknown) {
            if (!isUniqueViolation(error) || attempt === RANDOM_CODE_ATTEMPTS - 1) {
                throw error;
            }
        }
    }

    throw new Error("Unable to generate a unique short code");
}

export async function getUrlByShortCode(shortCode: string) {
    const cached = await getCachedUrl(shortCode);

    if (cached) {
        if (cached.expiresAt !== null && new Date(cached.expiresAt).getTime() <= Date.now()) {
            return { status: "expired" as const };
        }

        return {
            status: "found" as const,
            originalUrl: cached.originalUrl,
        };
    }

    const [url] = await db.select().from(urls).where(eq(urls.shortCode, shortCode)).limit(1);

    if (!url || !url.isActive) {
        return { status: "not_found" as const };
    }

    if (url.expiresAt && url.expiresAt.getTime() <= Date.now()) {
        return { status: "expired" as const };
    }

    await cacheUrl(shortCode, {
        originalUrl: url.originalUrl,
        expiresAt: url.expiresAt?.toISOString() ?? null,
    });

    return {
        status: "found" as const,
        originalUrl: url.originalUrl,
    };
}

export async function deactivateShortUrl(shortCode: string): Promise<boolean> {
    const updated = await db
        .update(urls)
        .set({ isActive: false })
        .where(eq(urls.shortCode, shortCode))
        .returning({ id: urls.id });

    if (updated.length === 0) {
        return false;
    }

    // Evict the cached redirect so the deactivated URL is not served stale.
    await invalidateCachedUrl(shortCode);

    return true;
}

function isUniqueViolation(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
