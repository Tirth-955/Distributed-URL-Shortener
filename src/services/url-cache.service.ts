import { redis } from "../config/redis.js";

const CACHE_TTL_SECONDS = 60;
const URL_CACHE_PREFIX = "url:";

export type CachedUrl = {
    originalUrl: string;
    expiresAt: string | null;
};

function getCacheKey(shortCode: string): string {
    return `${URL_CACHE_PREFIX}${shortCode}`;
}

export async function getCachedUrl(shortCode: string): Promise<CachedUrl | null> {
    try {
        const cached = await redis.get(getCacheKey(shortCode));

        if (!cached) {
            return null;
        }

        const parsed: unknown = JSON.parse(cached);

        if (
            typeof parsed !== "object" ||
            parsed === null ||
            !("originalUrl" in parsed) ||
            typeof parsed.originalUrl !== "string" ||
            !("expiresAt" in parsed) ||
            !(typeof parsed.expiresAt === "string" || parsed.expiresAt === null)
        ) {
            return null;
        }

        return {
            originalUrl: parsed.originalUrl,
            expiresAt: parsed.expiresAt,
        };
    } catch (error) {
        console.error("Redis cache read failed:", error);
        return null;
    }
}

export async function cacheUrl(shortCode: string, url: CachedUrl): Promise<void> {
    try {
        let ttl = CACHE_TTL_SECONDS;

        if (url.expiresAt !== null) {
            const remainingSeconds = Math.floor(
                (new Date(url.expiresAt).getTime() - Date.now()) / 1000
            );

            if (remainingSeconds <= 0) {
                return;
            }

            ttl = Math.min(ttl, remainingSeconds);
        }

        await redis.set(getCacheKey(shortCode), JSON.stringify(url), "EX", ttl);
    } catch (error) {
        console.error("Redis cache write failed:", error);
    }
}
