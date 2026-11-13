import { db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "../utils/api-key.js";

export type CreatedApiKey = {
    apiKey: string;
    keyPrefix: string;
};

export async function createApiKey(): Promise<CreatedApiKey> {
    const apiKey = generateApiKey();
    const keyPrefix = apiKeyPrefix(apiKey);

    await db.insert(apiKeys).values({
        keyHash: hashApiKey(apiKey),
        keyPrefix,
    });

    return { apiKey, keyPrefix };
}
