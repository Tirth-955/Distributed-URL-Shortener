import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

import type { Request, Response, NextFunction } from "express";
import { redis } from "../config/redis.js";

const WINDOW_SECONDS = 60;
const DEFAULT_LIMIT = 10;

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 or redis.call("TTL", KEYS[1]) == -1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
return {count, ttl}
`;

export function getClientIp(req: Request): string {
    const forwardedFor = req.headers["x-forwarded-for"];

    if (typeof forwardedFor === "string") {
        const lastEntry = forwardedFor.split(",").at(-1)?.trim() ?? "";

        if (isIP(lastEntry) !== 0) {
            return normalizeIp(lastEntry);
        }
    }

    if (req.ip && isIP(req.ip) !== 0) {
        return normalizeIp(req.ip);
    }

    return randomUUID();
}

function normalizeIp(ip: string): string {
    return ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
}

type RateLimiterOptions = {
    bucket: string;
    limit: number;
    windowSeconds?: number;
};

export function createRateLimiter({ bucket, limit, windowSeconds = WINDOW_SECONDS }: RateLimiterOptions) {
    return async function rateLimiter(req: Request, res: Response, next: NextFunction) {
        try {
            const ip = getClientIp(req);
            const key = `rate-limit:${bucket}:${ip}`;

            const result = (await redis.eval(RATE_LIMIT_SCRIPT, 1, key, windowSeconds)) as [
                number,
                number,
            ];

            const [count, ttl] = result;

            res.setHeader("RateLimit-Limit", limit);
            res.setHeader("RateLimit-Remaining", Math.max(0, limit - count));

            if (count > limit) {
                res.setHeader("Retry-After", Math.max(1, ttl));

                return res.status(429).json({
                    error: "Too many requests. Please try again later.",
                });
            }

            return next();
        } catch (error) {
            console.error("Rate limiter Redis error:", error);
            return next();
        }
    };
}

export const rateLimit = createRateLimiter({ bucket: "create-url", limit: DEFAULT_LIMIT });
export const createKeyRateLimit = createRateLimiter({ bucket: "create-key", limit: 5 });
