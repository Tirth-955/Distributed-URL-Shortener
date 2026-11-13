import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => ({
    eval: vi.fn(),
}));

// Do not require a live Redis connection.
vi.mock("../src/config/redis.js", () => ({
    redis: redisMock,
}));

import { createKeyRateLimit, getClientIp, rateLimit } from "../src/middleware/rate-limit.middleware.js";

function mockRequest(input: { headers?: Record<string, string | undefined>; ip?: string }) {
    return {
        headers: input.headers ?? {},
        ip: input.ip,
    } as unknown as Request;
}

function mockResponse() {
    const headers: Record<string, unknown> = {};
    const res: Record<string, unknown> = {
        setHeader: (name: string, value: unknown) => {
            headers[name] = value;
        },
        status: (code: number) => {
            headers.status = code;
            return res;
        },
        json: () => res,
    };
    return { res: res as never, headers };
}

describe("getClientIp", () => {
    it("uses the last X-Forwarded-For entry, ignoring client-supplied ones", () => {
        const req = mockRequest({
            headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.9, 203.0.113.7" },
            ip: "10.0.0.9",
        });

        expect(getClientIp(req)).toBe("203.0.113.7");
    });

    it("trims whitespace around the last X-Forwarded-For entry", () => {
        const req = mockRequest({
            headers: { "x-forwarded-for": "203.0.113.7 " },
        });

        expect(getClientIp(req)).toBe("203.0.113.7");
    });

    it("falls back to req.ip when X-Forwarded-For is not a valid IP", () => {
        const req = mockRequest({
            headers: { "x-forwarded-for": "not-an-ip" },
            ip: "203.0.113.7",
        });

        expect(getClientIp(req)).toBe("203.0.113.7");
    });

    it("falls back to req.ip when the header is absent", () => {
        const req = mockRequest({ ip: "203.0.113.7" });

        expect(getClientIp(req)).toBe("203.0.113.7");
    });

    it("strips the IPv6-mapped prefix", () => {
        const req = mockRequest({
            headers: { "x-forwarded-for": "::ffff:203.0.113.7" },
        });

        expect(getClientIp(req)).toBe("203.0.113.7");
    });

    it("keeps real IPv6 addresses intact", () => {
        const req = mockRequest({
            headers: { "x-forwarded-for": "2001:db8::1" },
        });

        expect(getClientIp(req)).toBe("2001:db8::1");
    });

    it("returns a unique key per request instead of a shared bucket", () => {
        const first = getClientIp(mockRequest({}));
        const second = getClientIp(mockRequest({}));

        expect(first).not.toBe("unknown");
        expect(second).not.toBe("unknown");
        expect(first).not.toBe(second);
    });
});

describe("rateLimit", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("forwards under the limit and sets standard headers", async () => {
        redisMock.eval.mockResolvedValue([3, 57]);
        const { res, headers } = mockResponse();
        const next = vi.fn();

        await rateLimit(mockRequest({ ip: "203.0.113.7" }), res, next);

        expect(next).toHaveBeenCalled();
        expect(headers.status).toBeUndefined();
        expect(headers["RateLimit-Limit"]).toBe(10);
        expect(headers["RateLimit-Remaining"]).toBe(7);
        expect(redisMock.eval).toHaveBeenCalledWith(expect.any(String), 1, "rate-limit:create-url:203.0.113.7", 60);
    });

    it("returns 429 past the limit with a Retry-After", async () => {
        redisMock.eval.mockResolvedValue([11, 42]);
        const { res, headers } = mockResponse();
        const next = vi.fn();

        await rateLimit(mockRequest({ ip: "203.0.113.7" }), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(headers.status).toBe(429);
        expect(headers["Retry-After"]).toBe(42);
        expect(headers["RateLimit-Remaining"]).toBe(0);
    });

    it("fails open when Redis is unavailable", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        redisMock.eval.mockRejectedValue(new Error("Redis is down"));
        const { res } = mockResponse();
        const next = vi.fn();

        await rateLimit(mockRequest({ ip: "203.0.113.7" }), res, next);

        expect(next).toHaveBeenCalled();
    });
});

describe("createKeyRateLimit", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("uses its own bucket and limit of 5 per window", async () => {
        redisMock.eval.mockResolvedValue([1, 60]);
        const { res, headers } = mockResponse();
        const next = vi.fn();

        await createKeyRateLimit(mockRequest({ ip: "203.0.113.7" }), res, next);

        expect(next).toHaveBeenCalled();
        expect(redisMock.eval).toHaveBeenCalledWith(
            expect.any(String),
            1,
            "rate-limit:create-key:203.0.113.7",
            60
        );
        expect(headers["RateLimit-Limit"]).toBe(5);
        expect(headers["RateLimit-Remaining"]).toBe(4);
    });

    it("returns 429 past the issuance limit", async () => {
        redisMock.eval.mockResolvedValue([6, 30]);
        const { res, headers } = mockResponse();
        const next = vi.fn();

        await createKeyRateLimit(mockRequest({ ip: "203.0.113.7" }), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(headers.status).toBe(429);
        expect(headers["Retry-After"]).toBe(30);
    });
});
