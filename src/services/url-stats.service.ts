import { eq, sql } from "drizzle-orm";

import { redis } from "../config/redis.js";
import { db } from "../db/index.js";
import { urls } from "../db/schema.js";

const CLICK_COUNT_PREFIX = "clicks:";
const SCAN_BATCH_SIZE = 100;

export function incrementClickCount(shortCode: string): void {
    redis.incr(`${CLICK_COUNT_PREFIX}${shortCode}`).catch((error: Error) => {
        console.error("Click count increment failed:", error.message);
    });
}

export async function flushClickCounts(): Promise<void> {
    try {
        const keys = await collectClickKeys();

        for (const key of keys) {
            const pending = await redis.getdel(key);
            const clicks = Number(pending ?? 0);

            if (!Number.isInteger(clicks) || clicks <= 0) {
                continue;
            }

            const shortCode = key.slice(CLICK_COUNT_PREFIX.length);

            await db
                .update(urls)
                .set({ clickCount: sql`${urls.clickCount} + ${clicks}` })
                .where(eq(urls.shortCode, shortCode));
        }
    } catch (error) {
        console.error("Click count flush failed:", error);
    }
}

async function collectClickKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";

    do {
        const [next, batch] = await redis.scan(
            cursor,
            "MATCH",
            `${CLICK_COUNT_PREFIX}*`,
            "COUNT",
            SCAN_BATCH_SIZE
        );

        cursor = next;
        keys.push(...batch);
    } while (cursor !== "0");

    return keys;
}

export async function getClickStats(shortCode: string) {
    const [url] = await db.select().from(urls).where(eq(urls.shortCode, shortCode)).limit(1);

    if (!url || !url.isActive) {
        return null;
    }

    let pending = 0;

    try {
        const value = await redis.get(`${CLICK_COUNT_PREFIX}${shortCode}`);
        pending = Number(value ?? 0);

        if (Number.isNaN(pending)) {
            pending = 0;
        }
    } catch (error) {
        console.error("Pending click count read failed:", error);
    }

    return {
        shortCode: url.shortCode,
        originalUrl: url.originalUrl,
        clicks: url.clickCount + pending,
    };
}
