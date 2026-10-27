import type { Request, Response, NextFunction } from "express";

import { env } from "../config/env.js";
import { createUrlSchema } from "../validators/url.validator.js";
import { ShortCodeTakenError } from "../utils/errors.js";
import { createShortUrl, deactivateShortUrl, getUrlByShortCode } from "../services/url.service.js";
import { getClickStats, incrementClickCount } from "../services/url-stats.service.js";

export async function createUrl(req: Request, res: Response, next: NextFunction) {
    const result = createUrlSchema.safeParse(req.body);

    if (!result.success) {
        return res.status(400).json({
            error: "Invalid request body",
            details: result.error.issues,
        });
    }

    try {
        const created = await createShortUrl({
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

        const stats = await getClickStats(shortCode);

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

export async function deactivateUrl(req: Request, res: Response, next: NextFunction) {
    try {
        const { shortCode } = req.params;

        if (typeof shortCode !== "string") {
            return res.status(400).json({
                error: "Invalid short code",
            });
        }

        const deactivated = await deactivateShortUrl(shortCode);

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
