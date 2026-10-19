import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { signInWithGitHub } from "../actions";

const ERRORS: Record<string, string> = {
  AccessDenied: "This GitHub account is not on the testing allowlist yet. Jaded is invite-only for now.",
};

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  const { error } = await searchParams;
  const code = typeof error === "string" ? error : undefined;

  return (
    <main className="public">
      <section className="sheet">
        <p className="label">Sign in</p>
        <h2>Sign in with GitHub</h2>
        {code && (
          <p className="notice" role="alert">
            {ERRORS[code] ?? "Sign-in did not complete. Please try again."}
          </p>
        )}
        <p>Jaded asks GitHub only for your public profile. It does not get access to your code at this step.</p>
        <form action={signInWithGitHub}>
          <button className="button" type="submit">
            Continue with GitHub
          </button>
        </form>
      </section>
    </main>
  );
}
