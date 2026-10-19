"use server";

import { signIn, signOut } from "@/auth";

// Server actions are POST-only and Next.js rejects cross-origin calls, which
// covers CSRF for these forms.
export async function signInWithGitHub() {
  await signIn("github", { redirectTo: "/dashboard" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
