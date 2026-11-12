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
    let keys: string[];

    try {
        keys = await collectClickKeys();
    } catch (error) {
        console.error("Click count flush failed:", error);
        return;
    }

    for (const key of keys) {
        await flushClickKey(key);
    }
}

async function flushClickKey(key: string): Promise<void> {
    const pending = await redis.getdel(key).catch((error: Error) => {
        console.error("Click count flush failed:", error);
        return null;
    });

    const clicks = Number(pending ?? 0);

    if (!Number.isInteger(clicks) || clicks <= 0) {
        return;
    }

    const shortCode = key.slice(CLICK_COUNT_PREFIX.length);

    try {
        const updated = await db
            .update(urls)
            .set({ clickCount: sql`${urls.clickCount} + ${clicks}` })
            .where(eq(urls.shortCode, shortCode))
            .returning({ id: urls.id });

        if (updated.length === 0) {
            console.warn(`Click count flushed for unknown short code "${shortCode}"`);
        }
    } catch (error) {
        console.error(`Click count write failed for "${shortCode}", re-crediting Redis:`, error);

        await redis.incrby(key, clicks).catch((recreditError: Error) => {
            console.error(
                `Click count re-credit failed for "${shortCode}", clicks may be lost:`,
                recreditError
            );
        });
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

    if (!url) {
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
