import type { Request, Response, NextFunction } from "express";
import { redis } from "../config/redis.js";

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 10;

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 or redis.call("TTL", KEYS[1]) == -1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
return {count, ttl}
`;

export async function rateLimit(req: Request, res: Response, next: NextFunction) {
    try {
        const ip = req.ip ?? "unknown";
        const key = `rate-limit:create-url:${ip}`;

        const result = (await redis.eval(RATE_LIMIT_SCRIPT, 1, key, WINDOW_SECONDS)) as [
            number,
            number,
        ];

        const [count, ttl] = result;

        res.setHeader("RateLimit-Limit", MAX_REQUESTS);
        res.setHeader("RateLimit-Remaining", Math.max(0, MAX_REQUESTS - count));

        if (count > MAX_REQUESTS) {
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
}
