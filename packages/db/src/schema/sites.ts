import { sql } from "drizzle-orm"
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { profiles } from "./profiles"

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    label: text("label"),
    isCompetitor: boolean("is_competitor").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqOwnerNormalized: uniqueIndex("sites_owner_normalized_url_idx").on(
      t.ownerId,
      t.normalizedUrl
    ),
    uniqOwnerSelf: uniqueIndex("sites_one_self_per_owner_idx")
      .on(t.ownerId)
      .where(sql`is_competitor = false`),
    ownerIdx: index("sites_owner_idx").on(t.ownerId),
  })
)
