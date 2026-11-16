import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => ({
    eval: vi.fn(),
}));

const envMock = vi.hoisted(() => ({
    RATE_LIMIT_ENABLED: true,
}));

// Do not require a live Redis connection.
vi.mock("../src/config/redis.js", () => ({
    redis: redisMock,
}));

vi.mock("../src/config/env.js", () => ({
    env: envMock,
}));

import {
    createKeyRateLimit,
    getClientIp,
    manageRateLimit,
    redirectRateLimit,
} from "../src/middleware/rate-limit.middleware.js";

function mockRequest(input: {
    headers?: Record<string, string | undefined>;
    ip?: string;
    ownerId?: number;
}) {
    return {
        headers: input.headers ?? {},
        ip: input.ip,
        ownerId: input.ownerId,
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

describe("manageRateLimit", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("keys the counter by owner id, not client IP", async () => {
        redisMock.eval.mockResolvedValue([1, 60]);
        const { res, headers } = mockResponse();
        const next = vi.fn();

        await manageRateLimit(mockRequest({ ownerId: 7, ip: "203.0.113.7" }), res, next);

        expect(next).toHaveBeenCalled();
        expect(redisMock.eval).toHaveBeenCalledWith(
            expect.any(String),
            1,
            "rate-limit:manage:7",
            60
        );
        expect(headers["RateLimit-Limit"]).toBe(60);
        expect(headers["RateLimit-Remaining"]).toBe(59);
    });

    it("never shares a bucket when the owner id is missing", async () => {
        redisMock.eval.mockResolvedValue([1, 60]);
        const { res } = mockResponse();
        const next = vi.fn();

        await manageRateLimit(mockRequest({ ip: "203.0.113.7" }), res, next);

        expect(next).toHaveBeenCalled();
        const [, , key] = redisMock.eval.mock.calls[0];

        expect(key).toMatch(/^rate-limit:manage:[0-9a-f-]{36}$/);
    });

    it("returns 429 past the limit with a Retry-After", async () => {
        redisMock.eval.mockResolvedValue([61, 42]);
        const { res, headers } = mockResponse();
        const next = vi.fn();

        await manageRateLimit(mockRequest({ ownerId: 7 }), res, next);

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

        await manageRateLimit(mockRequest({ ownerId: 7 }), res, next);

        expect(next).toHaveBeenCalled();
    });
});

describe("redirectRateLimit", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("keys the counter by client IP", async () => {
        redisMock.eval.mockResolvedValue([1, 60]);
        const { res, headers } = mockResponse();
        const next = vi.fn();

        await redirectRateLimit(mockRequest({ ip: "203.0.113.7" }), res, next);

        expect(next).toHaveBeenCalled();
        expect(redisMock.eval).toHaveBeenCalledWith(
            expect.any(String),
            1,
            "rate-limit:redirect:203.0.113.7",
            60
        );
        expect(headers["RateLimit-Limit"]).toBe(100);
        expect(headers["RateLimit-Remaining"]).toBe(99);
    });

    it("returns 429 past the limit", async () => {
        redisMock.eval.mockResolvedValue([101, 20]);
        const { res, headers } = mockResponse();
        const next = vi.fn();

        await redirectRateLimit(mockRequest({ ip: "203.0.113.7" }), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(headers.status).toBe(429);
        expect(headers["Retry-After"]).toBe(20);
    });
});

describe("rate limit kill switch", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.RATE_LIMIT_ENABLED = true;
    });

    it("skips limiting entirely when RATE_LIMIT_ENABLED=false", async () => {
        envMock.RATE_LIMIT_ENABLED = false;
        const { res } = mockResponse();
        const next = vi.fn();

        await manageRateLimit(mockRequest({ ownerId: 7 }), res, next);
        await redirectRateLimit(mockRequest({ ip: "203.0.113.7" }), res, next);

        expect(next).toHaveBeenCalledTimes(2);
        expect(redisMock.eval).not.toHaveBeenCalled();

        envMock.RATE_LIMIT_ENABLED = true;
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
