import { pgTable, serial, varchar, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const urls = pgTable("urls", {
    id: serial("id").primaryKey(),
    shortCode: varchar("short_code", { length: 12 }).notNull().unique(),
    originalUrl: text("original_url").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    isActive: boolean("is_active").default(true).notNull(),
    clickCount: integer("click_count").default(0).notNull(),
});
