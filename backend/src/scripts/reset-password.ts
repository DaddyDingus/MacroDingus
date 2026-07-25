// Run inside the container when someone forgets their password — there's no
// email/SMS infra for a self-hosted single-container app to send a reset link
// through, so this is the operator escape hatch instead. Passwords are bcrypt
// hashed, so there's nothing to "look up"; this sets a new one directly.
//
// Usage: docker exec -it macrotrack node dist/scripts/reset-password.js "Name" "new-password"
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";

const [name, newPassword] = process.argv.slice(2);

if (!name || !newPassword) {
  console.error('Usage: reset-password.js "Name" "new-password"');
  process.exit(1);
}
if (newPassword.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const [user] = await db.select().from(users).where(eq(users.name, name));
if (!user) {
  console.error(`No user named "${name}". Existing users:`);
  for (const u of await db.select().from(users)) console.error(` - ${u.name}`);
  process.exit(1);
}

const passwordHash = await bcrypt.hash(newPassword, 10);
await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
console.log(`Password reset for ${name}.`);
