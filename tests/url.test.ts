import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const mocks = vi.hoisted(() => ({
    createShortUrl: vi.fn(),
    getUrlByShortCode: vi.fn(),
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
}));

// Do not require a live Redis connection for endpoint tests.
vi.mock("../src/middleware/rate-limit.middleware.js", () => ({
    rateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
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
            expect(mocks.createShortUrl).toHaveBeenCalledWith("https://www.github.com", undefined);
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
            expect(mocks.createShortUrl).toHaveBeenCalledWith("https://www.github.com", 7);
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
    });

    describe("GET /:shortCode", () => {
        it("redirects to the original URL", async () => {
            mocks.getUrlByShortCode.mockResolvedValue({
                status: "found",
                originalUrl: "https://www.github.com",
            });

            const response = await request(app).get("/abc12345");

            expect(response.status).toBe(302);
            expect(response.headers.location).toBe("https://www.github.com");
        });

        it("returns 404 for an unknown short code", async () => {
            mocks.getUrlByShortCode.mockResolvedValue({
                status: "not_found",
            });

            const response = await request(app).get("/unknown123");

            expect(response.status).toBe(404);
            expect(response.body.error).toBe("Short URL not found");
        });

        it("returns 410 for an expired URL", async () => {
            mocks.getUrlByShortCode.mockResolvedValue({
                status: "expired",
            });

            const response = await request(app).get("/expired123");

            expect(response.status).toBe(410);
            expect(response.body.error).toBe("Short URL has expired");
        });
    });
});
