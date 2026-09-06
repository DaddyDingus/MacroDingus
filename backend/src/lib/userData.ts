import fs from "node:fs";
import path from "node:path";
import { sqlite } from "../db/index.js";

// The single canonical list of everything one person owns. Two callers need
// it — "Clear Account Data" (routes/account.ts) and an admin deleting someone
// (routes/admin.ts) — and a second hand-maintained copy is exactly how the
// event-plan tables came to be missed by the first one for as long as they
// were. Add a per-user table to the schema, add it here, and both paths stay
// correct; there is deliberately nowhere else to add it.
//
// `foods` is absent on purpose and must stay absent: food rows carry no
// userId and are shared by every account (see schema.ts), so removing one
// person must never take a food that another person's logs still point at.
// A recipe's materialized food row survives its owner for the same reason.

// Children first — db/index.ts runs with `foreign_keys = ON`, so a parent row
// cannot go while anything still references it. Each is reachable only via its
// parent, hence the subquery rather than a userId column of its own.
const CHILD_TABLES: { table: string; key: string; parent: string }[] = [
  { table: "program_days", key: "program_id", parent: "programs" },
  { table: "recipe_ingredients", key: "recipe_id", parent: "recipes" },
  { table: "event_plan_days", key: "plan_id", parent: "event_plans" },
];

// Every table with a user_id, ordered so that referenced rows outlive their
// referrers. Verified against `PRAGMA foreign_key_list` for all 20 tables that
// reference users(id).
const USER_TABLES = [
  "logs",
  "nutrition_day_statuses",
  "daily_adjustments",
  "measurements",
  "favorites",
  "cookware",
  "food_search_stats",
  "step_records",
  "step_daily_totals",
  "step_sync_state",
  "steps_webhook_tokens",
  "user_settings",
  "event_plans",
  "recipes",
  "programs",
  "checkins",
  "goals",
  "weights",
  "photos",
  "profiles",
];

/**
 * Deletes every row and file belonging to one account, leaving the `users`
 * row itself intact.
 *
 * The options argument remains for call-site compatibility. AI credentials
 * now belong to the central gateway; historical local key files are retained
 * untouched until the owner deliberately revokes and removes them later.
 */
export async function purgeUserData(
  userId: string,
  dataDir: string,
  _options: { removeSecrets?: boolean } = {},
): Promise<void> {
  // One transaction: a partial teardown would leave rows pointing at an
  // account that no longer resolves, and the caller in routes/admin.ts is
  // about to delete the users row on the strength of this having worked.
  const purge = sqlite.transaction(() => {
    for (const { table, key, parent } of CHILD_TABLES) {
      sqlite
        .prepare(`DELETE FROM "${table}" WHERE "${key}" IN (SELECT id FROM "${parent}" WHERE user_id = ?)`)
        .run(userId);
    }
    for (const table of USER_TABLES) {
      sqlite.prepare(`DELETE FROM "${table}" WHERE user_id = ?`).run(userId);
    }
  });
  purge();

  await fs.promises.rm(path.join(dataDir, "photos", path.basename(userId)), { recursive: true, force: true });
}
