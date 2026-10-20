import { db } from "@/lib/db";

export async function resetDatabase() {
  const client = db();
  await client.update.deleteMany();
  await client.webhookDelivery.deleteMany();
  await client.storeListing.deleteMany();
  await client.brandProfile.deleteMany();
  await client.app.deleteMany();
  await client.repository.deleteMany();
  await client.gitHubInstallation.deleteMany();
  await client.auditLog.deleteMany();
  await client.session.deleteMany();
  await client.account.deleteMany();
  await client.membership.deleteMany();
  await client.workspace.deleteMany();
  await client.user.deleteMany();
}
