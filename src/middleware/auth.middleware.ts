import { and, eq, isNull } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";

import { db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import { apiKeyPrefix, hashApiKey } from "../utils/api-key.js";

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
    const header = req.headers["x-api-key"];
    const apiKey = typeof header === "string" ? header.trim() : "";

    if (apiKey === "") {
        return res.status(401).json({
            error: "Missing API key",
        });
    }

    try {
        const [key] = await db
            .select()
            .from(apiKeys)
            .where(and(eq(apiKeys.keyHash, hashApiKey(apiKey)), isNull(apiKeys.revokedAt)))
            .limit(1);

        if (!key) {
            console.warn(`Rejected API key with prefix "${apiKeyPrefix(apiKey)}"`);

            return res.status(401).json({
                error: "Invalid API key",
            });
        }

        req.ownerId = key.id;
        req.apiKeyPrefix = key.keyPrefix;

        return next();
    } catch (error) {
        next(error);
    }
}
