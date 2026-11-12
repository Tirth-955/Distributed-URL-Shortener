import { redis } from "../config/redis.js";

const CACHE_TTL_SECONDS = 60;
const TOMBSTONE_TTL_SECONDS = CACHE_TTL_SECONDS * 2;
const URL_CACHE_PREFIX = "url:";

export type CachedUrl = {
    originalUrl: string;
    expiresAt: string | null;
};

export type CacheLookupResult = CachedUrl | "tombstone" | null;

function getCacheKey(shortCode: string): string {
    return `${URL_CACHE_PREFIX}${shortCode}`;
}

function isTombstone(value: unknown): boolean {
    return (
        typeof value === "object" &&
        value !== null &&
        "tombstone" in value &&
        value.tombstone === true
    );
}

export async function getCachedUrl(shortCode: string): Promise<CacheLookupResult> {
    try {
        const cached = await redis.get(getCacheKey(shortCode));

        if (!cached) {
            return null;
        }

        const parsed: unknown = JSON.parse(cached);

        if (isTombstone(parsed)) {
            return "tombstone";
        }

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

export async function cacheUrlIfAbsent(shortCode: string, url: CachedUrl): Promise<void> {
    try {
        let ttl = CACHE_TTL_SECONDS;

        if (url.expiresAt !== null) {
            const expiryTime = new Date(url.expiresAt).getTime();
            if (Number.isNaN(expiryTime)) {
                return;
            }

            const remainingSeconds = Math.floor((expiryTime - Date.now()) / 1000);

            if (remainingSeconds <= 0) {
                return;
            }

            ttl = Math.min(ttl, remainingSeconds);
        }

        await redis.set(getCacheKey(shortCode), JSON.stringify(url), "EX", ttl, "NX");
    } catch (error) {
        console.error("Redis cache write failed:", error);
    }
}

export async function tombstoneCachedUrl(shortCode: string): Promise<void> {
    try {
        await redis.set(
            getCacheKey(shortCode),
            JSON.stringify({ tombstone: true }),
            "EX",
            TOMBSTONE_TTL_SECONDS
        );
    } catch (error) {
        console.error("Redis tombstone write failed:", error);
    }
}
