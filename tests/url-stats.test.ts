import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => ({
    get: vi.fn(),
}));

const dbMock = vi.hoisted(() => ({
    select: vi.fn(),
}));

// Do not require a live Redis or Postgres connection.
vi.mock("../src/config/redis.js", () => ({
    redis: redisMock,
}));

vi.mock("../src/db/index.js", () => ({
    db: dbMock,
}));

import { getClickStats } from "../src/services/url-stats.service.js";

const DEACTIVATED_URL = {
    shortCode: "abc12345",
    originalUrl: "https://www.github.com",
    clickCount: 7,
    isActive: false,
};

function mockSelectRow(row: unknown) {
    dbMock.select.mockReturnValue({
        from: () => ({
            where: () => ({
                limit: async () => [row],
            }),
        }),
    });
}

describe("URL stats service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns lifetime clicks for a deactivated link", async () => {
        mockSelectRow(DEACTIVATED_URL);
        redisMock.get.mockResolvedValue("5");

        expect(await getClickStats("abc12345")).toEqual({
            shortCode: "abc12345",
            originalUrl: "https://www.github.com",
            clicks: 12,
        });
    });

    it("returns null for an unknown short code", async () => {
        mockSelectRow(undefined);

        expect(await getClickStats("unknown1")).toBeNull();
    });

    it("treats a missing Redis counter as zero", async () => {
        mockSelectRow({ ...DEACTIVATED_URL, isActive: true, clickCount: 0 });
        redisMock.get.mockResolvedValue(null);

        expect(await getClickStats("abc12345")).toMatchObject({ clicks: 0 });
    });

    it("degrades to the Postgres count when Redis is unavailable", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        mockSelectRow({ ...DEACTIVATED_URL, isActive: true, clickCount: 3 });
        redisMock.get.mockRejectedValue(new Error("Redis is down"));

        expect(await getClickStats("abc12345")).toMatchObject({ clicks: 3 });
    });
});
