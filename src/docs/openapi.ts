import type { JsonObject } from "swagger-ui-express";

export const openapiSpec: JsonObject = {
    openapi: "3.0.3",
    info: {
        title: "Distributed URL Shortener API",
        version: "1.0.0",
        description:
            "REST API for creating, listing, and deactivating short URLs, with public redirects and click stats. " +
            "Management routes are owner-scoped via `X-API-Key`. Another owner's link is indistinguishable from unknown (`404`, never `403`).",
    },
    servers: [{ url: "/", description: "Current host" }],
    tags: [
        { name: "Health", description: "Liveness" },
        { name: "Keys", description: "API key issuance" },
        { name: "URLs", description: "Authenticated short-URL management" },
        { name: "Redirects", description: "Public redirect path" },
    ],
    components: {
        securitySchemes: {
            ApiKeyAuth: {
                type: "apiKey",
                in: "header",
                name: "X-API-Key",
                description: "Management key issued by `POST /api/v1/keys` (`usk_…`).",
            },
        },
        parameters: {
            ShortCode: {
                name: "shortCode",
                in: "path",
                required: true,
                schema: { type: "string", minLength: 4, maxLength: 12 },
                description: "Short code (4–12 characters).",
            },
        },
        headers: {
            RateLimitLimit: {
                description: "Maximum requests allowed in the current window.",
                schema: { type: "integer" },
            },
            RateLimitRemaining: {
                description: "Requests remaining in the current window.",
                schema: { type: "integer" },
            },
            RetryAfter: {
                description: "Seconds until the rate-limit window resets.",
                schema: { type: "integer" },
            },
        },
        schemas: {
            Error: {
                type: "object",
                required: ["error"],
                properties: {
                    error: { type: "string" },
                },
            },
            ValidationError: {
                type: "object",
                required: ["error"],
                properties: {
                    error: { type: "string" },
                    details: {
                        type: "array",
                        items: { type: "object", additionalProperties: true },
                        description: "Zod issue list when present.",
                    },
                },
            },
            CreateUrlRequest: {
                type: "object",
                required: ["url"],
                properties: {
                    url: {
                        type: "string",
                        format: "uri",
                        description: "Destination URL. Only `http` and `https` are accepted.",
                        example: "https://github.com/trending",
                    },
                    expiresInDays: {
                        type: "integer",
                        minimum: 1,
                        maximum: 365,
                        description: "Optional lifetime in days.",
                    },
                    customCode: {
                        type: "string",
                        minLength: 4,
                        maxLength: 12,
                        pattern: "^[A-Za-z0-9_-]+$",
                        description:
                            "Optional alias. Letters, numbers, hyphens, and underscores only. Reserved codes (`health`, `api`, `urls`, `docs`, `openapi`) return 409.",
                    },
                },
            },
            ShortUrlCreated: {
                type: "object",
                required: ["shortCode", "originalUrl", "shortUrl", "expiresAt"],
                properties: {
                    shortCode: { type: "string", example: "gh-trend" },
                    originalUrl: { type: "string", format: "uri" },
                    shortUrl: {
                        type: "string",
                        format: "uri",
                        example: "http://localhost:3000/gh-trend",
                    },
                    expiresAt: { type: "string", format: "date-time", nullable: true },
                },
            },
            UrlListItem: {
                type: "object",
                required: [
                    "id",
                    "shortCode",
                    "originalUrl",
                    "createdAt",
                    "expiresAt",
                    "isActive",
                    "clickCount",
                ],
                properties: {
                    id: { type: "integer" },
                    shortCode: { type: "string" },
                    originalUrl: { type: "string", format: "uri" },
                    createdAt: { type: "string", format: "date-time" },
                    expiresAt: { type: "string", format: "date-time", nullable: true },
                    isActive: { type: "boolean" },
                    clickCount: { type: "integer", minimum: 0 },
                },
            },
            UrlList: {
                type: "object",
                required: ["items", "nextCursor"],
                properties: {
                    items: { type: "array", items: { $ref: "#/components/schemas/UrlListItem" } },
                    nextCursor: {
                        type: "string",
                        nullable: true,
                        description:
                            "Opaque cursor for the next page, or null when there are no more rows.",
                    },
                },
            },
            ClickStats: {
                type: "object",
                required: ["shortCode", "originalUrl", "clicks"],
                properties: {
                    shortCode: { type: "string" },
                    originalUrl: { type: "string", format: "uri" },
                    clicks: {
                        type: "integer",
                        minimum: 0,
                        description: "Persisted Postgres clicks plus pending Redis increments.",
                    },
                },
            },
            ApiKeyCreated: {
                type: "object",
                required: ["apiKey", "keyPrefix", "note"],
                properties: {
                    apiKey: {
                        type: "string",
                        description: "Full key. Shown once; stored only as a SHA-256 hash.",
                        example: "usk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                    },
                    keyPrefix: { type: "string", example: "usk_xxxxxxxx" },
                    note: { type: "string" },
                },
            },
            Health: {
                type: "object",
                required: ["status", "message", "instance"],
                properties: {
                    status: { type: "string", example: "ok" },
                    message: { type: "string" },
                    instance: { type: "string", description: "Hostname of the serving instance." },
                },
            },
        },
        responses: {
            BadRequest: {
                description: "Invalid JSON, body, query, or cursor.",
                content: {
                    "application/json": {
                        schema: { $ref: "#/components/schemas/ValidationError" },
                    },
                },
            },
            Unauthorized: {
                description: "Missing or invalid API key.",
                content: {
                    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
                },
            },
            NotFound: {
                description: "Unknown short code, or a link owned by another key.",
                content: {
                    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
                },
            },
            Conflict: {
                description: "Custom short code is taken or reserved.",
                content: {
                    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
                },
            },
            Gone: {
                description: "Short URL is expired or deactivated.",
                content: {
                    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
                },
            },
            TooManyRequests: {
                description: "Rate limit exceeded for this bucket.",
                headers: {
                    "RateLimit-Limit": { $ref: "#/components/headers/RateLimitLimit" },
                    "RateLimit-Remaining": { $ref: "#/components/headers/RateLimitRemaining" },
                    "Retry-After": { $ref: "#/components/headers/RetryAfter" },
                },
                content: {
                    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
                },
            },
            InternalError: {
                description: "Unexpected server error.",
                content: {
                    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
                },
            },
        },
    },
    paths: {
        "/health": {
            get: {
                tags: ["Health"],
                summary: "Liveness probe",
                operationId: "getHealth",
                responses: {
                    "200": {
                        description: "API is running.",
                        content: {
                            "application/json": { schema: { $ref: "#/components/schemas/Health" } },
                        },
                    },
                },
            },
        },
        "/api/v1/keys": {
            post: {
                tags: ["Keys"],
                summary: "Issue a management API key",
                description:
                    "Returns the plaintext key once. Limited to 5 requests per IP per minute.",
                operationId: "createApiKey",
                responses: {
                    "201": {
                        description: "Key created. Store `apiKey` immediately.",
                        headers: {
                            "RateLimit-Limit": { $ref: "#/components/headers/RateLimitLimit" },
                            "RateLimit-Remaining": {
                                $ref: "#/components/headers/RateLimitRemaining",
                            },
                        },
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/ApiKeyCreated" },
                            },
                        },
                    },
                    "429": { $ref: "#/components/responses/TooManyRequests" },
                    "500": { $ref: "#/components/responses/InternalError" },
                },
            },
        },
        "/api/v1/urls": {
            post: {
                tags: ["URLs"],
                summary: "Create a short URL",
                operationId: "createUrl",
                security: [{ ApiKeyAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/CreateUrlRequest" },
                        },
                    },
                },
                responses: {
                    "201": {
                        description: "Short URL created.",
                        headers: {
                            "RateLimit-Limit": { $ref: "#/components/headers/RateLimitLimit" },
                            "RateLimit-Remaining": {
                                $ref: "#/components/headers/RateLimitRemaining",
                            },
                        },
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/ShortUrlCreated" },
                            },
                        },
                    },
                    "400": { $ref: "#/components/responses/BadRequest" },
                    "401": { $ref: "#/components/responses/Unauthorized" },
                    "409": { $ref: "#/components/responses/Conflict" },
                    "429": { $ref: "#/components/responses/TooManyRequests" },
                    "500": { $ref: "#/components/responses/InternalError" },
                },
            },
            get: {
                tags: ["URLs"],
                summary: "List the authenticated key's URLs",
                description:
                    "Cursor pagination, newest first (`created_at DESC, id DESC`). Default `limit` is 20 (max 100).",
                operationId: "listUrls",
                security: [{ ApiKeyAuth: [] }],
                parameters: [
                    {
                        name: "limit",
                        in: "query",
                        schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
                    },
                    {
                        name: "cursor",
                        in: "query",
                        schema: { type: "string", minLength: 1 },
                        description: "`nextCursor` from a previous response.",
                    },
                ],
                responses: {
                    "200": {
                        description: "Page of URLs owned by this key.",
                        headers: {
                            "RateLimit-Limit": { $ref: "#/components/headers/RateLimitLimit" },
                            "RateLimit-Remaining": {
                                $ref: "#/components/headers/RateLimitRemaining",
                            },
                        },
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/UrlList" },
                            },
                        },
                    },
                    "400": { $ref: "#/components/responses/BadRequest" },
                    "401": { $ref: "#/components/responses/Unauthorized" },
                    "429": { $ref: "#/components/responses/TooManyRequests" },
                    "500": { $ref: "#/components/responses/InternalError" },
                },
            },
        },
        "/api/v1/urls/{shortCode}/stats": {
            get: {
                tags: ["URLs"],
                summary: "Get click stats for a short URL",
                operationId: "getUrlStats",
                security: [{ ApiKeyAuth: [] }],
                parameters: [{ $ref: "#/components/parameters/ShortCode" }],
                responses: {
                    "200": {
                        description: "Click statistics, including deactivated links.",
                        headers: {
                            "RateLimit-Limit": { $ref: "#/components/headers/RateLimitLimit" },
                            "RateLimit-Remaining": {
                                $ref: "#/components/headers/RateLimitRemaining",
                            },
                        },
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/ClickStats" },
                            },
                        },
                    },
                    "400": { $ref: "#/components/responses/BadRequest" },
                    "401": { $ref: "#/components/responses/Unauthorized" },
                    "404": { $ref: "#/components/responses/NotFound" },
                    "429": { $ref: "#/components/responses/TooManyRequests" },
                    "500": { $ref: "#/components/responses/InternalError" },
                },
            },
        },
        "/api/v1/urls/{shortCode}": {
            delete: {
                tags: ["URLs"],
                summary: "Deactivate a short URL",
                description: "Soft-deletes the link and tombstones the Redis cache entry.",
                operationId: "deactivateUrl",
                security: [{ ApiKeyAuth: [] }],
                parameters: [{ $ref: "#/components/parameters/ShortCode" }],
                responses: {
                    "204": {
                        description: "Deactivated.",
                        headers: {
                            "RateLimit-Limit": { $ref: "#/components/headers/RateLimitLimit" },
                            "RateLimit-Remaining": {
                                $ref: "#/components/headers/RateLimitRemaining",
                            },
                        },
                    },
                    "400": { $ref: "#/components/responses/BadRequest" },
                    "401": { $ref: "#/components/responses/Unauthorized" },
                    "404": { $ref: "#/components/responses/NotFound" },
                    "429": { $ref: "#/components/responses/TooManyRequests" },
                    "500": { $ref: "#/components/responses/InternalError" },
                },
            },
        },
        "/{shortCode}": {
            get: {
                tags: ["Redirects"],
                summary: "Redirect to the original URL",
                description:
                    "Public. Limited to 100 requests per IP per minute. Records a click on a successful redirect.",
                operationId: "redirectUrl",
                parameters: [{ $ref: "#/components/parameters/ShortCode" }],
                responses: {
                    "302": {
                        description: "Redirect to the original URL.",
                        headers: {
                            Location: {
                                description: "Original destination URL.",
                                schema: { type: "string", format: "uri" },
                            },
                            "RateLimit-Limit": { $ref: "#/components/headers/RateLimitLimit" },
                            "RateLimit-Remaining": {
                                $ref: "#/components/headers/RateLimitRemaining",
                            },
                        },
                    },
                    "400": { $ref: "#/components/responses/BadRequest" },
                    "404": { $ref: "#/components/responses/NotFound" },
                    "410": { $ref: "#/components/responses/Gone" },
                    "429": { $ref: "#/components/responses/TooManyRequests" },
                    "500": { $ref: "#/components/responses/InternalError" },
                },
            },
        },
    },
};
