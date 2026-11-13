import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

import { ShortCodeTakenError } from "../src/utils/errors.js";
import { encodeCursor } from "../src/utils/cursor.js";

const mocks = vi.hoisted(() => ({
    createShortUrl: vi.fn(),
    getUrlByShortCode: vi.fn(),
    deactivateShortUrl: vi.fn(),
    listUrlsByOwner: vi.fn(),
    incrementClickCount: vi.fn(),
    getClickStats: vi.fn(),
}));

// Keep tests independent of real environment variables and database services.
vi.mock("../src/config/env.js", () => ({
    env: {
        BASE_URL: "http://localhost:3000",
    },
}));

vi.mock("../src/services/url.service.js", () => ({
    createShortUrl: mocks.createShortUrl,
    getUrlByShortCode: mocks.getUrlByShortCode,
    deactivateShortUrl: mocks.deactivateShortUrl,
    listUrlsByOwner: mocks.listUrlsByOwner,
}));

vi.mock("../src/services/url-stats.service.js", () => ({
    incrementClickCount: mocks.incrementClickCount,
    getClickStats: mocks.getClickStats,
}));

// Do not require a live Redis connection for endpoint tests.
vi.mock("../src/middleware/rate-limit.middleware.js", () => ({
    rateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
    createKeyRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Authenticated as owner 1 for every endpoint test.
vi.mock("../src/middleware/auth.middleware.js", () => ({
    requireApiKey: (req: { ownerId?: number } & Record<string, unknown>, _res: unknown, next: () => void) => {
        req.ownerId = 1;
        next();
    },
}));

import app from "../src/app.js";

describe("URL Shortener API", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("GET /health", () => {
        it("returns 200 when the API is running", async () => {
            const response = await request(app).get("/health");

            expect(response.status).toBe(200);
        });
    });

    describe("POST /api/v1/urls", () => {
        it("creates a short URL", async () => {
            mocks.createShortUrl.mockResolvedValue({
                shortCode: "abc12345",
                originalUrl: "https://www.github.com",
                expiresAt: null,
            });

            const response = await request(app)
                .post("/api/v1/urls")
                .send({ url: "https://www.github.com" });

            expect(response.status).toBe(201);
            expect(response.body).toMatchObject({
                shortCode: "abc12345",
                originalUrl: "https://www.github.com",
                shortUrl: "http://localhost:3000/abc12345",
                expiresAt: null,
            });
            expect(mocks.createShortUrl).toHaveBeenCalledWith({
                ownerId: 1,
                originalUrl: "https://www.github.com",
                expiresInDays: undefined,
                customCode: undefined,
            });
        });

        it("supports URL expiration", async () => {
            const expiresAt = new Date("2027-01-01T00:00:00.000Z");

            mocks.createShortUrl.mockResolvedValue({
                shortCode: "expire123",
                originalUrl: "https://www.github.com",
                expiresAt,
            });

            const response = await request(app).post("/api/v1/urls").send({
                url: "https://www.github.com",
                expiresInDays: 7,
            });

            expect(response.status).toBe(201);
            expect(response.body.expiresAt).toBe(expiresAt.toISOString());
            expect(mocks.createShortUrl).toHaveBeenCalledWith({
                ownerId: 1,
                originalUrl: "https://www.github.com",
                expiresInDays: 7,
                customCode: undefined,
            });
        });

        it("supports a custom short code", async () => {
            mocks.createShortUrl.mockResolvedValue({
                shortCode: "my-github",
                originalUrl: "https://www.github.com",
                expiresAt: null,
            });

            const response = await request(app).post("/api/v1/urls").send({
                url: "https://www.github.com",
                customCode: "my-github",
            });

            expect(response.status).toBe(201);
            expect(response.body.shortCode).toBe("my-github");
            expect(mocks.createShortUrl).toHaveBeenCalledWith({
                ownerId: 1,
                originalUrl: "https://www.github.com",
                expiresInDays: undefined,
                customCode: "my-github",
            });
        });

        it("rejects a custom short code that is too short", async () => {
            const response = await request(app)
                .post("/api/v1/urls")
                .send({ url: "https://www.github.com", customCode: "ab" });

            expect(response.status).toBe(400);
            expect(mocks.createShortUrl).not.toHaveBeenCalled();
        });

        it("rejects a custom short code with invalid characters", async () => {
            const response = await request(app)
                .post("/api/v1/urls")
                .send({ url: "https://www.github.com", customCode: "my github!" });

            expect(response.status).toBe(400);
            expect(mocks.createShortUrl).not.toHaveBeenCalled();
        });

        it("returns 409 when a custom short code is taken", async () => {
            mocks.createShortUrl.mockRejectedValue(new ShortCodeTakenError("my-github"));

            const response = await request(app)
                .post("/api/v1/urls")
                .send({ url: "https://www.github.com", customCode: "my-github" });

            expect(response.status).toBe(409);
        });

        it("rejects an invalid URL", async () => {
            const response = await request(app).post("/api/v1/urls").send({ url: "not-a-url" });

            expect(response.status).toBe(400);
            expect(mocks.createShortUrl).not.toHaveBeenCalled();
        });

        it("rejects unsupported protocols", async () => {
            const response = await request(app)
                .post("/api/v1/urls")
                .send({ url: "ftp://example.com/file.txt" });

            expect(response.status).toBe(400);
            expect(mocks.createShortUrl).not.toHaveBeenCalled();
        });

        it("rejects an invalid expiration period", async () => {
            const response = await request(app).post("/api/v1/urls").send({
                url: "https://www.github.com",
                expiresInDays: 0,
            });

            expect(response.status).toBe(400);
            expect(mocks.createShortUrl).not.toHaveBeenCalled();
        });

        it("returns 400 for malformed JSON request body", async () => {
            const response = await request(app)
                .post("/api/v1/urls")
                .set("Content-Type", "application/json")
                .send('{"url": "https://www.github.com"');

            expect(response.status).toBe(400);
            expect(response.body.error).toBe("Invalid JSON in request body");
        });
    });

    describe("GET /:shortCode", () => {
        it("redirects to the original URL and records a click", async () => {
            mocks.getUrlByShortCode.mockResolvedValue({
                status: "found",
                originalUrl: "https://www.github.com",
            });

            const response = await request(app).get("/abc12345");

            expect(response.status).toBe(302);
            expect(response.headers.location).toBe("https://www.github.com");
            expect(mocks.incrementClickCount).toHaveBeenCalledWith("abc12345");
        });

        it("returns 404 for an unknown short code", async () => {
            mocks.getUrlByShortCode.mockResolvedValue({
                status: "not_found",
            });

            const response = await request(app).get("/unknown123");

            expect(response.status).toBe(404);
            expect(response.body.error).toBe("Short URL not found");
            expect(mocks.incrementClickCount).not.toHaveBeenCalled();
        });

        it("returns 410 for an expired URL", async () => {
            mocks.getUrlByShortCode.mockResolvedValue({
                status: "expired",
            });

            const response = await request(app).get("/expired123");

            expect(response.status).toBe(410);
            expect(response.body.error).toBe("Short URL has expired");
            expect(mocks.incrementClickCount).not.toHaveBeenCalled();
        });

        it("returns 410 for a deactivated URL", async () => {
            mocks.getUrlByShortCode.mockResolvedValue({
                status: "deactivated",
            });

            const response = await request(app).get("/deactivated1");

            expect(response.status).toBe(410);
            expect(response.body.error).toBe("Short URL has been deactivated");
            expect(mocks.incrementClickCount).not.toHaveBeenCalled();
        });
    });

    describe("GET /api/v1/urls/:shortCode/stats", () => {
        it("returns click statistics", async () => {
            mocks.getClickStats.mockResolvedValue({
                shortCode: "abc12345",
                originalUrl: "https://www.github.com",
                clicks: 42,
            });

            const response = await request(app).get("/api/v1/urls/abc12345/stats");

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({
                shortCode: "abc12345",
                originalUrl: "https://www.github.com",
                clicks: 42,
            });
        });

        it("returns stats for a deactivated link", async () => {
            mocks.getClickStats.mockResolvedValue({
                shortCode: "deactiv1",
                originalUrl: "https://www.github.com",
                clicks: 7,
            });

            const response = await request(app).get("/api/v1/urls/deactiv1/stats");

            expect(response.status).toBe(200);
            expect(response.body.clicks).toBe(7);
        });

        it("returns 404 for an unknown short code", async () => {
            mocks.getClickStats.mockResolvedValue(null);

            const response = await request(app).get("/api/v1/urls/unknown123/stats");

            expect(response.status).toBe(404);
        });

        it("returns 404 for another owner's link, indistinguishable from unknown", async () => {
            mocks.getClickStats.mockResolvedValue(null);

            const response = await request(app).get("/api/v1/urls/notmine1/stats");

            expect(response.status).toBe(404);
            expect(response.body).toEqual({ error: "Short URL not found" });
        });
    });

    describe("GET /api/v1/urls", () => {
        it("lists the owner's URLs with a next cursor", async () => {
            const items = [
                {
                    shortCode: "abc12345",
                    originalUrl: "https://www.github.com",
                    createdAt: new Date("2026-11-01T00:00:00.000Z"),
                    expiresAt: null,
                    isActive: true,
                    clickCount: 5,
                },
            ];
            mocks.listUrlsByOwner.mockResolvedValue({ items, nextCursor: "tok" });

            const response = await request(app).get("/api/v1/urls").query({ limit: 1 });

            expect(response.status).toBe(200);
            expect(response.body.nextCursor).toBe("tok");
            expect(response.body.items[0]).toMatchObject({
                shortCode: "abc12345",
                clickCount: 5,
            });
            expect(mocks.listUrlsByOwner).toHaveBeenCalledWith(1, { limit: 1, cursor: null });
        });

        it("decodes a cursor into the service options", async () => {
            mocks.listUrlsByOwner.mockResolvedValue({ items: [], nextCursor: null });

            const cursor = encodeCursor(new Date("2026-11-01T00:00:00.000Z"), 9);

            await request(app).get("/api/v1/urls").query({ cursor });

            expect(mocks.listUrlsByOwner).toHaveBeenCalledWith(1, {
                limit: 20,
                cursor: { createdAt: new Date("2026-11-01T00:00:00.000Z"), id: 9 },
            });
        });

        it("returns 400 for an out-of-range limit", async () => {
            const response = await request(app).get("/api/v1/urls").query({ limit: 0 });

            expect(response.status).toBe(400);
            expect(mocks.listUrlsByOwner).not.toHaveBeenCalled();
        });

        it("returns 400 for an invalid cursor", async () => {
            const response = await request(app).get("/api/v1/urls").query({ cursor: "garbage" });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe("Invalid cursor");
            expect(mocks.listUrlsByOwner).not.toHaveBeenCalled();
        });
    });

    describe("DELETE /api/v1/urls/:shortCode", () => {
        it("deactivates a short URL", async () => {
            mocks.deactivateShortUrl.mockResolvedValue(true);

            const response = await request(app).delete("/api/v1/urls/abc12345");

            expect(response.status).toBe(204);
            expect(mocks.deactivateShortUrl).toHaveBeenCalledWith("abc12345", 1);
        });

        it("returns 404 for an unknown short code", async () => {
            mocks.deactivateShortUrl.mockResolvedValue(false);

            const response = await request(app).delete("/api/v1/urls/unknown123");

            expect(response.status).toBe(404);
        });

        it("returns 404 for another owner's link, indistinguishable from unknown", async () => {
            mocks.deactivateShortUrl.mockResolvedValue(false);

            const response = await request(app).delete("/api/v1/urls/notmine1");

            expect(response.status).toBe(404);
            expect(response.body).toEqual({ error: "Short URL not found" });
        });
    });
});
