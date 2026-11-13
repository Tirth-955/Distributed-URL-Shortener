import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheMock = vi.hoisted(() => ({
    getCachedUrl: vi.fn().mockResolvedValue(null),
    cacheUrlIfAbsent: vi.fn().mockResolvedValue(undefined),
    tombstoneCachedUrl: vi.fn().mockResolvedValue(undefined),
    markUrlExpired: vi.fn().mockResolvedValue(undefined),
}));

const dbMock = vi.hoisted(() => ({
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
}));

// Do not require a live Redis or Postgres connection.
vi.mock("../src/config/redis.js", () => ({ redis: {} }));

vi.mock("../src/services/url-cache.service.js", () => cacheMock);

vi.mock("../src/db/index.js", () => ({ db: dbMock }));

import { createShortUrl, deactivateShortUrl, getUrlByShortCode } from "../src/services/url.service.js";

function mockSelectRow(row: unknown) {
    dbMock.select.mockReturnValue({
        from: () => ({
            where: () => ({
                limit: async () => [row],
            }),
        }),
    });
}

const ACTIVE_URL = {
    shortCode: "abc12345",
    originalUrl: "https://www.github.com",
    expiresAt: null,
    isActive: true,
};

describe("getUrlByShortCode", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cacheMock.getCachedUrl.mockResolvedValue(null);
    });

    it("serves an active entry from the cache", async () => {
        cacheMock.getCachedUrl.mockResolvedValue({
            originalUrl: "https://www.github.com",
            expiresAt: null,
        });

        expect(await getUrlByShortCode("abc12345")).toEqual({
            status: "found",
            originalUrl: "https://www.github.com",
        });
        expect(dbMock.select).not.toHaveBeenCalled();
    });

    it("maps a deactivation tombstone to deactivated without a Postgres read", async () => {
        cacheMock.getCachedUrl.mockResolvedValue("tombstone");

        expect(await getUrlByShortCode("abc12345")).toEqual({ status: "deactivated" });
        expect(dbMock.select).not.toHaveBeenCalled();
    });

    it("maps an expired marker to expired without a Postgres read", async () => {
        cacheMock.getCachedUrl.mockResolvedValue("expired");

        expect(await getUrlByShortCode("abc12345")).toEqual({ status: "expired" });
        expect(dbMock.select).not.toHaveBeenCalled();
    });

    it("marks a cached entry expired the moment its expiry passes", async () => {
        cacheMock.getCachedUrl.mockResolvedValue({
            originalUrl: "https://www.github.com",
            expiresAt: new Date(Date.now() - 1_000).toISOString(),
        });

        expect(await getUrlByShortCode("abc12345")).toEqual({ status: "expired" });
        expect(cacheMock.markUrlExpired).toHaveBeenCalledWith("abc12345");
    });

    it("returns expired for an expired row and writes the marker", async () => {
        mockSelectRow({
            ...ACTIVE_URL,
            expiresAt: new Date(Date.now() - 1_000),
        });

        expect(await getUrlByShortCode("abc12345")).toEqual({ status: "expired" });
        expect(cacheMock.markUrlExpired).toHaveBeenCalledWith("abc12345");
        expect(cacheMock.cacheUrlIfAbsent).not.toHaveBeenCalled();
    });

    it("caches an active row on a cache miss", async () => {
        const expiresAt = new Date(Date.now() + 86_400_000);
        mockSelectRow({ ...ACTIVE_URL, expiresAt });

        expect(await getUrlByShortCode("abc12345")).toEqual({
            status: "found",
            originalUrl: "https://www.github.com",
        });
        expect(cacheMock.cacheUrlIfAbsent).toHaveBeenCalledWith("abc12345", {
            originalUrl: "https://www.github.com",
            expiresAt: expiresAt.toISOString(),
        });
        expect(cacheMock.markUrlExpired).not.toHaveBeenCalled();
    });

    it("returns deactivated for an inactive row without caching", async () => {
        mockSelectRow({ ...ACTIVE_URL, isActive: false });

        expect(await getUrlByShortCode("abc12345")).toEqual({ status: "deactivated" });
        expect(cacheMock.cacheUrlIfAbsent).not.toHaveBeenCalled();
    });

    it("returns not_found for an unknown short code", async () => {
        mockSelectRow(undefined);

        expect(await getUrlByShortCode("unknown1")).toEqual({ status: "not_found" });
        expect(cacheMock.cacheUrlIfAbsent).not.toHaveBeenCalled();
    });
});

describe("createShortUrl", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cacheMock.getCachedUrl.mockResolvedValue(null);
    });

    it("stamps the owner id on creation with a custom code", async () => {
        const inserted: Record<string, unknown>[] = [];
        dbMock.insert.mockReturnValue({
            values: async (values: Record<string, unknown>) => {
                inserted.push(values);
            },
        });

        const created = await createShortUrl({
            ownerId: 7,
            originalUrl: "https://www.github.com",
            customCode: "my-github",
        });

        expect(created).toEqual({
            shortCode: "my-github",
            originalUrl: "https://www.github.com",
            expiresAt: null,
        });
        expect(inserted[0]).toMatchObject({
            ownerId: 7,
            shortCode: "my-github",
            originalUrl: "https://www.github.com",
        });
    });

    it("stamps the owner id on creation with a random code", async () => {
        const inserted: Record<string, unknown>[] = [];
        dbMock.insert.mockReturnValue({
            values: async (values: Record<string, unknown>) => {
                inserted.push(values);
            },
        });

        const created = await createShortUrl({
            ownerId: 7,
            originalUrl: "https://www.github.com",
        });

        expect(created.shortCode).toMatch(/^[A-Za-z0-9_-]{8}$/);
        expect(inserted[0]).toMatchObject({ ownerId: 7 });
    });
});

describe("deactivateShortUrl", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cacheMock.getCachedUrl.mockResolvedValue(null);
    });

    it("deactivates and tombstones the cache for the owner", async () => {
        dbMock.update.mockReturnValue({
            set: () => ({
                where: () => ({
                    returning: async () => [{ id: 1 }],
                }),
            }),
        });

        expect(await deactivateShortUrl("abc12345", 7)).toBe(true);
        expect(cacheMock.tombstoneCachedUrl).toHaveBeenCalledWith("abc12345");
    });

    it("does nothing when the link belongs to another owner", async () => {
        dbMock.update.mockReturnValue({
            set: () => ({
                where: () => ({
                    returning: async () => [],
                }),
            }),
        });

        expect(await deactivateShortUrl("abc12345", 99)).toBe(false);
        expect(cacheMock.tombstoneCachedUrl).not.toHaveBeenCalled();
    });
});
