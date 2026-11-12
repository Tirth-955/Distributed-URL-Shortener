import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => ({
    get: vi.fn(),
    set: vi.fn(),
}));

// Do not require a live Redis connection for cache tests.
vi.mock("../src/config/redis.js", () => ({
    redis: redisMock,
}));

import {
    cacheUrlIfAbsent,
    getCachedUrl,
    tombstoneCachedUrl,
} from "../src/services/url-cache.service.js";

const ACTIVE_ENTRY = JSON.stringify({
    originalUrl: "https://www.github.com",
    expiresAt: null,
});
const TOMBSTONE = JSON.stringify({ tombstone: true });

describe("URL cache service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("getCachedUrl", () => {
        it("returns null on a cache miss", async () => {
            redisMock.get.mockResolvedValue(null);

            expect(await getCachedUrl("abc12345")).toBeNull();
        });

        it("returns the cached entry", async () => {
            redisMock.get.mockResolvedValue(ACTIVE_ENTRY);

            expect(await getCachedUrl("abc12345")).toEqual({
                originalUrl: "https://www.github.com",
                expiresAt: null,
            });
        });

        it("returns a tombstone for a deactivated link", async () => {
            redisMock.get.mockResolvedValue(TOMBSTONE);

            expect(await getCachedUrl("abc12345")).toBe("tombstone");
        });

        it("returns null for malformed JSON", async () => {
            vi.spyOn(console, "error").mockImplementation(() => {});
            redisMock.get.mockResolvedValue("{not-json");

            expect(await getCachedUrl("abc12345")).toBeNull();
        });

        it("returns null when the entry does not match the expected shape", async () => {
            redisMock.get.mockResolvedValue(JSON.stringify({ nope: true }));

            expect(await getCachedUrl("abc12345")).toBeNull();
        });
    });

    describe("cacheUrlIfAbsent", () => {
        it("populates the cache with NX and the default TTL", async () => {
            await cacheUrlIfAbsent("abc12345", {
                originalUrl: "https://www.github.com",
                expiresAt: null,
            });

            expect(redisMock.set).toHaveBeenCalledWith("url:abc12345", ACTIVE_ENTRY, "EX", 60, "NX");
        });

        it("clamps the TTL to the link's remaining lifetime", async () => {
            const expiresAt = new Date(Date.now() + 10_000).toISOString();

            await cacheUrlIfAbsent("abc12345", {
                originalUrl: "https://www.github.com",
                expiresAt,
            });

            const [, , command, ttl, mode] = redisMock.set.mock.calls[0];

            expect(command).toBe("EX");
            expect(ttl).toBeLessThanOrEqual(10);
            expect(ttl).toBeGreaterThan(0);
            expect(mode).toBe("NX");
        });

        it("does not write an entry whose link is already expired", async () => {
            const expiresAt = new Date(Date.now() - 1_000).toISOString();

            await cacheUrlIfAbsent("abc12345", {
                originalUrl: "https://www.github.com",
                expiresAt,
            });

            expect(redisMock.set).not.toHaveBeenCalled();
        });
    });

    describe("tombstoneCachedUrl", () => {
        it("overwrites the entry with a tombstone that outlives the cache TTL", async () => {
            await tombstoneCachedUrl("abc12345");

            expect(redisMock.set).toHaveBeenCalledWith("url:abc12345", TOMBSTONE, "EX", 120);
        });
    });

    it("does not throw when Redis fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        redisMock.set.mockRejectedValue(new Error("Redis is down"));

        await expect(tombstoneCachedUrl("abc12345")).resolves.toBeUndefined();

        await expect(
            cacheUrlIfAbsent("abc12345", {
                originalUrl: "https://www.github.com",
                expiresAt: null,
            })
        ).resolves.toBeUndefined();
    });
});
