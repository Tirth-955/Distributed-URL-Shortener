import type { Request, Response, NextFunction } from "express";

import { env } from "../config/env.js";
import { createUrlSchema, listUrlsQuerySchema } from "../validators/url.validator.js";
import { ShortCodeTakenError } from "../utils/errors.js";
import { createShortUrl, deactivateShortUrl, getUrlByShortCode, listUrlsByOwner } from "../services/url.service.js";
import { getClickStats, incrementClickCount } from "../services/url-stats.service.js";
import { decodeCursor } from "../utils/cursor.js";

export async function createUrl(req: Request, res: Response, next: NextFunction) {
    const ownerId = req.ownerId;

    if (ownerId === undefined) {
        return res.status(401).json({
            error: "Missing API key",
        });
    }

    const result = createUrlSchema.safeParse(req.body);

    if (!result.success) {
        return res.status(400).json({
            error: "Invalid request body",
            details: result.error.issues,
        });
    }

    try {
        const created = await createShortUrl({
            ownerId,
            originalUrl: result.data.url,
            expiresInDays: result.data.expiresInDays,
            customCode: result.data.customCode,
        });

        const baseUrl = env.BASE_URL.replace(/\/+$/, "");
        const shortUrl = `${baseUrl}/${created.shortCode}`;

        return res.status(201).json({
            shortCode: created.shortCode,
            originalUrl: created.originalUrl,
            shortUrl,
            expiresAt: created.expiresAt,
        });
    } catch (error) {
        if (error instanceof ShortCodeTakenError) {
            return res.status(409).json({
                error: error.message,
            });
        }

        next(error);
    }
}

export async function redirectUrl(req: Request, res: Response, next: NextFunction) {
    try {
        const { shortCode } = req.params;

        if (typeof shortCode !== "string") {
            return res.status(400).json({
                error: "Invalid short code",
            });
        }

        const result = await getUrlByShortCode(shortCode);

        if (result.status === "not_found") {
            return res.status(404).json({
                error: "Short URL not found",
            });
        }

        if (result.status === "deactivated") {
            return res.status(410).json({
                error: "Short URL has been deactivated",
            });
        }

        if (result.status === "expired") {
            return res.status(410).json({
                error: "Short URL has expired",
            });
        }

        incrementClickCount(shortCode);

        return res.redirect(302, result.originalUrl);
    } catch (error) {
        next(error);
    }
}

export async function getClickStatsHandler(req: Request, res: Response, next: NextFunction) {
    try {
        const { shortCode } = req.params;

        if (typeof shortCode !== "string") {
            return res.status(400).json({
                error: "Invalid short code",
            });
        }

        const ownerId = req.ownerId;

        if (ownerId === undefined) {
            return res.status(401).json({
                error: "Missing API key",
            });
        }

        const stats = await getClickStats(shortCode, ownerId);

        if (!stats) {
            return res.status(404).json({
                error: "Short URL not found",
            });
        }

        return res.status(200).json(stats);
    } catch (error) {
        next(error);
    }
}

export async function listUrls(req: Request, res: Response, next: NextFunction) {
    const ownerId = req.ownerId;

    if (ownerId === undefined) {
        return res.status(401).json({
            error: "Missing API key",
        });
    }

    const query = listUrlsQuerySchema.safeParse(req.query);

    if (!query.success) {
        return res.status(400).json({
            error: "Invalid query parameters",
            details: query.error.issues,
        });
    }

    let cursor: { createdAt: Date; id: number } | null = null;

    if (query.data.cursor) {
        cursor = decodeCursor(query.data.cursor);

        if (!cursor) {
            return res.status(400).json({
                error: "Invalid cursor",
            });
        }
    }

    try {
        const result = await listUrlsByOwner(ownerId, {
            limit: query.data.limit,
            cursor,
        });

        return res.status(200).json({
            items: result.items,
            nextCursor: result.nextCursor,
        });
    } catch (error) {
        next(error);
    }
}

export async function deactivateUrl(req: Request, res: Response, next: NextFunction) {
    try {
        const { shortCode } = req.params;

        if (typeof shortCode !== "string") {
            return res.status(400).json({
                error: "Invalid short code",
            });
        }

        const ownerId = req.ownerId;

        if (ownerId === undefined) {
            return res.status(401).json({
                error: "Missing API key",
            });
        }

        const deactivated = await deactivateShortUrl(shortCode, ownerId);

        if (!deactivated) {
            return res.status(404).json({
                error: "Short URL not found",
            });
        }

        return res.status(204).send();
    } catch (error) {
        next(error);
    }
}
