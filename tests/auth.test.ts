import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
    select: vi.fn(),
}));

// Do not require a live Postgres connection.
vi.mock("../src/db/index.js", () => ({
    db: dbMock,
}));

import { requireApiKey } from "../src/middleware/auth.middleware.js";
import { generateApiKey } from "../src/utils/api-key.js";

function mockRequest(headers: Record<string, string | undefined>) {
    return { headers } as unknown as Request;
}

function mockResponse() {
    const res: Record<string, unknown> = {
        status: (code: number) => {
            res.code = code;
            return res;
        },
        json: (body: unknown) => {
            res.body = body;
            return res;
        },
    };
    return { res: res as never, state: res as { code?: number; body?: unknown } };
}

const VALID_KEY = generateApiKey();
const KEY_ROW = { id: 7, keyHash: "hash", keyPrefix: VALID_KEY.slice(0, 12), revokedAt: null };

describe("requireApiKey", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("rejects a missing header with 401", async () => {
        const { res, state } = mockResponse();
        const next = vi.fn();

        await requireApiKey(mockRequest({}), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(state.code).toBe(401);
        expect(state.body).toEqual({ error: "Missing API key" });
    });

    it("rejects a blank header with 401", async () => {
        const { res, state } = mockResponse();
        const next = vi.fn();

        await requireApiKey(mockRequest({ "x-api-key": "   " }), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(state.code).toBe(401);
    });

    it("rejects an unknown key with 401", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        dbMock.select.mockReturnValue({
            from: () => ({
                where: () => ({
                    limit: async () => [],
                }),
            }),
        });
        const { res, state } = mockResponse();
        const next = vi.fn();

        await requireApiKey(mockRequest({ "x-api-key": generateApiKey() }), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(state.code).toBe(401);
        expect(state.body).toEqual({ error: "Invalid API key" });
    });

    it("attaches the owner identity for a valid key", async () => {
        dbMock.select.mockReturnValue({
            from: () => ({
                where: () => ({
                    limit: async () => [KEY_ROW],
                }),
            }),
        });
        const { res } = mockResponse();
        const next = vi.fn();
        const req = mockRequest({ "x-api-key": VALID_KEY }) as Request & {
            ownerId?: number;
            apiKeyPrefix?: string;
        };

        await requireApiKey(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.ownerId).toBe(7);
        expect(req.apiKeyPrefix).toBe(VALID_KEY.slice(0, 12));
    });

    it("trims whitespace around the key before hashing", async () => {
        dbMock.select.mockReturnValue({
            from: () => ({
                where: () => ({
                    limit: async () => [KEY_ROW],
                }),
            }),
        });
        const { res } = mockResponse();
        const next = vi.fn();

        await requireApiKey(mockRequest({ "x-api-key": `  ${VALID_KEY}  ` }), res, next);

        expect(next).toHaveBeenCalled();
    });

    it("fails closed when the database is unavailable", async () => {
        const error = new Error("Postgres is down");
        dbMock.select.mockImplementation(() => {
            throw error;
        });
        const { res } = mockResponse();
        const next = vi.fn();

        await requireApiKey(mockRequest({ "x-api-key": VALID_KEY }), res, next);

        expect(next).toHaveBeenCalledWith(error);
    });

    it("never logs the raw key", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        dbMock.select.mockReturnValue({
            from: () => ({
                where: () => ({
                    limit: async () => [],
                }),
            }),
        });

        await requireApiKey(mockRequest({ "x-api-key": VALID_KEY }), mockResponse().res, vi.fn());

        expect(warn).toHaveBeenCalledWith(expect.stringContaining(VALID_KEY.slice(0, 12)));
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining(VALID_KEY.slice(12)));
    });
});
