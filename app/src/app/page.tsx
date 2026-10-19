import Link from "next/link";
import { auth } from "@/auth";

export default async function Home() {
  const session = await auth();
  return (
    <main className="public">
      <section className="sheet">
        <p className="label">Jaded</p>
        <h1>Your app&rsquo;s updates, turned into posts.</h1>
        <p>
          Jaded will read your pushes and app store listing and draft social posts for you to review. It is being built
          now and is invite-only while we test.
        </p>
        {session?.user ? (
          <Link className="button" href="/dashboard">
            Open your dashboard
          </Link>
        ) : (
          <Link className="button" href="/signin">
            Sign in
          </Link>
        )}
      </section>
    </main>
  );
}
