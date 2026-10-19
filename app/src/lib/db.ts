import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Lazily created Prisma client. Nothing connects at startup, so the app runs
 * without a reachable database until a feature needs one.
 * Prisma always uses parameterized queries; never build raw SQL from strings.
 */
export function db(): PrismaClient {
  globalForPrisma.prisma ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: env().DATABASE_URL }),
  });
  return globalForPrisma.prisma;
}
