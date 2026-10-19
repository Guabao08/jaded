import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { recordAudit } from "@/lib/audit";
import { isOAuthCallback, revokePresentedSession } from "@/lib/auth/rotate";
import { db } from "@/lib/db";

async function withRotation(request: NextRequest, handler: (request: NextRequest) => Promise<Response>) {
  if (isOAuthCallback(request)) await revokePresentedSession(request, { db, audit: recordAudit });
  return handler(request);
}

export const GET = (request: NextRequest) => withRotation(request, handlers.GET);
export const POST = (request: NextRequest) => withRotation(request, handlers.POST);
