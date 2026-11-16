import { pgTable, serial, varchar, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const apiKeys = pgTable("api_keys", {
    id: serial("id").primaryKey(),
    keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
    keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
});

export const urls = pgTable("urls", {
    id: serial("id").primaryKey(),
    ownerId: integer("owner_id")
        .notNull()
        .references(() => apiKeys.id, { onDelete: "restrict" }),
    shortCode: varchar("short_code", { length: 12 }).notNull().unique(),
    originalUrl: text("original_url").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    isActive: boolean("is_active").default(true).notNull(),
    clickCount: integer("click_count").default(0).notNull(),
});
