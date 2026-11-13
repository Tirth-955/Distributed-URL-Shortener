import { and, desc, eq, lt, or } from "drizzle-orm";

import { db } from "../db/index.js";
import { urls } from "../db/schema.js";
import { ShortCodeTakenError } from "../utils/errors.js";
import { generateShortCode } from "../utils/generate-short-code.js";
import {
    cacheUrlIfAbsent,
    getCachedUrl,
    markUrlExpired,
    tombstoneCachedUrl,
} from "./url-cache.service.js";
import { encodeCursor } from "../utils/cursor.js";

const RESERVED_SHORT_CODES = new Set(["health", "api", "urls"]);
const RANDOM_CODE_ATTEMPTS = 3;

export type CreateShortUrlInput = {
    originalUrl: string;
    ownerId: number;
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
                ownerId: input.ownerId,
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
                ownerId: input.ownerId,
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

    if (cached === "tombstone") {
        return { status: "deactivated" as const };
    }

    if (cached === "expired") {
        return { status: "expired" as const };
    }

    if (cached) {
        if (cached.expiresAt !== null && new Date(cached.expiresAt).getTime() <= Date.now()) {
            await markUrlExpired(shortCode);

            return { status: "expired" as const };
        }

        return {
            status: "found" as const,
            originalUrl: cached.originalUrl,
        };
    }

    const [url] = await db.select().from(urls).where(eq(urls.shortCode, shortCode)).limit(1);

    if (!url) {
        return { status: "not_found" as const };
    }

    if (!url.isActive) {
        return { status: "deactivated" as const };
    }

    if (url.expiresAt && url.expiresAt.getTime() <= Date.now()) {
        await markUrlExpired(shortCode);

        return { status: "expired" as const };
    }

    await cacheUrlIfAbsent(shortCode, {
        originalUrl: url.originalUrl,
        expiresAt: url.expiresAt?.toISOString() ?? null,
    });

    return {
        status: "found" as const,
        originalUrl: url.originalUrl,
    };
}

export async function deactivateShortUrl(shortCode: string, ownerId: number): Promise<boolean> {
    const updated = await db
        .update(urls)
        .set({ isActive: false })
        .where(and(eq(urls.shortCode, shortCode), eq(urls.ownerId, ownerId)))
        .returning({ id: urls.id });

    if (updated.length === 0) {
        return false;
    }

    await tombstoneCachedUrl(shortCode);

    return true;
}

export type UrlListOptions = {
    limit: number;
    cursor?: { createdAt: Date; id: number } | null;
};

export type UrlListItem = {
    shortCode: string;
    originalUrl: string;
    createdAt: Date;
    expiresAt: Date | null;
    isActive: boolean;
    clickCount: number;
};

export async function listUrlsByOwner(ownerId: number, options: UrlListOptions) {
    const cursorCondition = options.cursor
        ? or(
              lt(urls.createdAt, options.cursor.createdAt),
              and(eq(urls.createdAt, options.cursor.createdAt), lt(urls.id, options.cursor.id))
          )
        : undefined;

    const rows = await db
        .select({
            id: urls.id,
            shortCode: urls.shortCode,
            originalUrl: urls.originalUrl,
            createdAt: urls.createdAt,
            expiresAt: urls.expiresAt,
            isActive: urls.isActive,
            clickCount: urls.clickCount,
        })
        .from(urls)
        .where(and(eq(urls.ownerId, ownerId), cursorCondition))
        .orderBy(desc(urls.createdAt), desc(urls.id))
        .limit(options.limit + 1);

    const hasMore = rows.length > options.limit;
    const items = hasMore ? rows.slice(0, options.limit) : rows;
    const last = items[items.length - 1];

    return {
        items,
        nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
}

function isUniqueViolation(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
