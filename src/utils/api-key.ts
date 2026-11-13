import { createHash, randomBytes } from "node:crypto";

const API_KEY_PREFIX = "usk_";
const API_KEY_BYTES = 32;

const KEY_PREFIX_LENGTH = API_KEY_PREFIX.length + 8;

export function generateApiKey(): string {
    return `${API_KEY_PREFIX}${randomBytes(API_KEY_BYTES).toString("base64url")}`;
}

export function hashApiKey(apiKey: string): string {
    return createHash("sha256").update(apiKey).digest("hex");
}

export function apiKeyPrefix(apiKey: string): string {
    return apiKey.slice(0, KEY_PREFIX_LENGTH);
}
