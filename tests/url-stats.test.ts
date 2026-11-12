import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => ({
    get: vi.fn().mockResolvedValue(null),
    scan: vi.fn().mockResolvedValue(["0", []]),
    getdel: vi.fn().mockResolvedValue("0"),
    incrby: vi.fn().mockResolvedValue(0),
}));

const dbMock = vi.hoisted(() => ({
    select: vi.fn(),
    update: vi.fn().mockImplementation(() => okUpdateChain()),
}));

// Do not require a live Redis or Postgres connection.
vi.mock("../src/config/redis.js", () => ({
    redis: redisMock,
}));

vi.mock("../src/db/index.js", () => ({
    db: dbMock,
}));

import { flushClickCounts, getClickStats } from "../src/services/url-stats.service.js";

function okUpdateChain(result: unknown[] = [{ id: 1 }]) {
    return {
        set: () => ({
            where: () => ({
                returning: async () => result,
            }),
        }),
    };
}

function failingUpdateChain() {
    return {
        set: () => ({
            where: () => ({
                returning: async () => {
                    throw new Error("Postgres is down");
                },
            }),
        }),
    };
}

function mockSelectRow(row: unknown) {
    dbMock.select.mockReturnValue({
        from: () => ({
            where: () => ({
                limit: async () => [row],
            }),
        }),
    });
}

const DEACTIVATED_URL = {
    shortCode: "abc12345",
    originalUrl: "https://www.github.com",
    clickCount: 7,
    isActive: false,
};

describe("getClickStats", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbMock.update.mockImplementation(() => okUpdateChain());
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

describe("flushClickCounts", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbMock.update.mockImplementation(() => okUpdateChain());
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("moves pending Redis counters into Postgres", async () => {
        redisMock.scan.mockResolvedValue(["0", ["clicks:abc12345"]]);
        redisMock.getdel.mockResolvedValue("5");

        await flushClickCounts();

        expect(dbMock.update).toHaveBeenCalledTimes(1);
        expect(redisMock.incrby).not.toHaveBeenCalled();
    });

    it("re-credits the Redis counter when the Postgres write fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        redisMock.scan.mockResolvedValue(["0", ["clicks:abc12345"]]);
        redisMock.getdel.mockResolvedValue("5");
        dbMock.update.mockImplementation(() => failingUpdateChain());

        await flushClickCounts();

        expect(redisMock.incrby).toHaveBeenCalledWith("clicks:abc12345", 5);
    });

    it("keeps flushing the remaining keys when one key fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        redisMock.scan.mockResolvedValue(["0", ["clicks:aaa1", "clicks:bbb2"]]);
        redisMock.getdel.mockResolvedValueOnce("5").mockResolvedValueOnce("3");
        dbMock.update
            .mockImplementationOnce(() => failingUpdateChain())
            .mockImplementationOnce(() => okUpdateChain());

        await flushClickCounts();

        expect(dbMock.update).toHaveBeenCalledTimes(2);
        expect(redisMock.incrby).toHaveBeenCalledTimes(1);
        expect(redisMock.incrby).toHaveBeenCalledWith("clicks:aaa1", 5);
    });

    it("does nothing when no counters are pending", async () => {
        redisMock.scan.mockResolvedValue(["0", []]);

        await flushClickCounts();

        expect(redisMock.getdel).not.toHaveBeenCalled();
        expect(dbMock.update).not.toHaveBeenCalled();
    });

    it("skips empty or non-numeric counters", async () => {
        redisMock.scan.mockResolvedValue(["0", ["clicks:abc12345"]]);
        redisMock.getdel.mockResolvedValue("not-a-number");

        await flushClickCounts();

        expect(dbMock.update).not.toHaveBeenCalled();
    });

    it("does not throw when Redis is unreachable", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        redisMock.scan.mockRejectedValue(new Error("Redis is down"));

        await expect(flushClickCounts()).resolves.toBeUndefined();

        expect(dbMock.update).not.toHaveBeenCalled();
    });

    it("does not throw when the re-credit itself fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        redisMock.scan.mockResolvedValue(["0", ["clicks:abc12345"]]);
        redisMock.getdel.mockResolvedValue("5");
        dbMock.update.mockImplementation(() => failingUpdateChain());
        redisMock.incrby.mockRejectedValueOnce(new Error("Redis is down"));

        await expect(flushClickCounts()).resolves.toBeUndefined();
    });
});
