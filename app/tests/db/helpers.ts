import { db } from "@/lib/db";

export async function resetDatabase() {
  const client = db();
  await client.auditLog.deleteMany();
  await client.session.deleteMany();
  await client.account.deleteMany();
  await client.membership.deleteMany();
  await client.workspace.deleteMany();
  await client.user.deleteMany();
}
