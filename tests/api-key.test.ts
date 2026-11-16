import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
    inserted: [] as Record<string, unknown>[],
    insert: vi.fn(() => ({
        values: async (values: Record<string, unknown>) => {
            dbMock.inserted.push(values);
        },
    })),
}));

vi.mock("../src/config/env.js", () => ({
    env: { BASE_URL: "http://localhost:3000" },
}));

vi.mock("../src/config/redis.js", () => ({
    redis: {},
}));

vi.mock("../src/db/index.js", () => ({
    db: dbMock,
}));

vi.mock("../src/middleware/rate-limit.middleware.js", () => ({
    createKeyRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
    manageRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
    redirectRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from "../src/app.js";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "../src/utils/api-key.js";
import { createApiKey } from "../src/services/api-key.service.js";

describe("generateApiKey", () => {
    it("uses the usk_ prefix and base64url characters only", () => {
        const apiKey = generateApiKey();

        expect(apiKey).toMatch(/^usk_[A-Za-z0-9_-]+$/);
        expect(apiKey).toHaveLength(47); // "usk_" + 32 random bytes base64url
    });

    it("generates unique keys", () => {
        const keys = new Set(Array.from({ length: 100 }, () => generateApiKey()));

        expect(keys.size).toBe(100);
    });
});

describe("hashApiKey", () => {
    it("returns a 64-character lowercase hex SHA-256 digest", () => {
        expect(hashApiKey("usk_test")).toMatch(/^[a-f0-9]{64}$/);
    });

    it("is deterministic and never equals the raw key", () => {
        const first = hashApiKey("usk_test");
        const second = hashApiKey("usk_test");

        expect(second).toBe(first);
        expect(first).not.toBe("usk_test");
    });

    it("differs for different keys", () => {
        expect(hashApiKey("usk_a")).not.toBe(hashApiKey("usk_b"));
    });
});

describe("apiKeyPrefix", () => {
    it("keeps the prefix and first 8 random characters", () => {
        const apiKey = generateApiKey();

        expect(apiKeyPrefix(apiKey)).toBe(apiKey.slice(0, 12));
        expect(apiKeyPrefix(apiKey)).toMatch(/^usk_[A-Za-z0-9_-]{8}$/);
    });
});

describe("createApiKey (service)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbMock.inserted.length = 0;
    });

    it("stores only the hash and prefix, returning the raw key once", async () => {
        const created = await createApiKey();

        expect(created.apiKey).toMatch(/^usk_/);
        expect(created.keyPrefix).toBe(created.apiKey.slice(0, 12));

        expect(dbMock.inserted).toHaveLength(1);
        const stored = dbMock.inserted[0];

        expect(stored.keyHash).toMatch(/^[a-f0-9]{64}$/);
        expect(stored.keyHash).toBe(hashApiKey(created.apiKey));
        expect(stored.keyPrefix).toBe(created.keyPrefix);

        // The plaintext key must never reach the database layer.
        expect(JSON.stringify(dbMock.inserted)).not.toContain(created.apiKey);
    });
});

describe("POST /api/v1/keys", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbMock.inserted.length = 0;
    });

    it("returns the key once with a warning", async () => {
        const response = await request(app).post("/api/v1/keys");

        expect(response.status).toBe(201);
        expect(response.body.apiKey).toMatch(/^usk_/);
        expect(response.body.keyPrefix).toBe(response.body.apiKey.slice(0, 12));
        expect(response.body.note).toMatch(/shown only once/i);
    });

    it("returns 500 when the key cannot be stored", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        dbMock.insert.mockImplementationOnce(() => ({
            values: async () => {
                throw new Error("Postgres is down");
            },
        }));

        const response = await request(app).post("/api/v1/keys");

        expect(response.status).toBe(500);
        expect(response.body.error).toBe("Internal server error");
    });
});
