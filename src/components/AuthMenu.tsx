import { authClient } from "~/lib/auth-client";

function displayName(name: string | null | undefined, email: string | null | undefined) {
  return name || email || "Account";
}

export default function AuthMenu() {
  const session = authClient.useSession();

  const signIn = (provider: "github" | "google") => {
    void authClient.signIn.social({
      provider,
      callbackURL: window.location.href,
    });
  };

  const signOut = () => {
    void authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.reload();
        },
      },
    });
  };

  if (session.isPending) {
    return (
      <div
        className="h-8 w-16 rounded-md border border-[var(--color-atlas-line)] bg-[var(--color-atlas-bg)]"
        aria-hidden="true"
      />
    );
  }

  if (!session.data) {
    return (
      <details className="relative">
        <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer inline-flex h-8 items-center justify-center rounded-md border border-[var(--color-atlas-line)] px-2.5 text-sm font-medium text-[var(--color-atlas-muted)] hover:text-[var(--color-atlas-ink)]">
          Sign in
        </summary>
        <div className="absolute right-0 top-full z-30 mt-2 flex w-36 flex-col rounded-md border border-[var(--color-atlas-line)] bg-[var(--color-atlas-surface)] p-1.5 shadow-lg">
          <button
            type="button"
            onClick={() => signIn("github")}
            className="rounded px-3 py-2 text-left text-sm text-[var(--color-atlas-muted)] hover:bg-[var(--color-atlas-bg)] hover:text-[var(--color-atlas-ink)]"
          >
            GitHub
          </button>
          <button
            type="button"
            onClick={() => signIn("google")}
            className="rounded px-3 py-2 text-left text-sm text-[var(--color-atlas-muted)] hover:bg-[var(--color-atlas-bg)] hover:text-[var(--color-atlas-ink)]"
          >
            Google
          </button>
        </div>
      </details>
    );
  }

  const user = session.data.user;

  return (
    <details className="relative">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer inline-flex h-8 max-w-36 items-center gap-2 rounded-md border border-[var(--color-atlas-line)] px-2 text-sm font-medium text-[var(--color-atlas-muted)] hover:text-[var(--color-atlas-ink)]">
        {user.image ? (
          <img
            src={user.image}
            alt=""
            className="h-5 w-5 shrink-0 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span
            className="h-5 w-5 shrink-0 rounded-full bg-[var(--color-atlas-accent-soft)]"
            aria-hidden="true"
          />
        )}
        <span className="hidden truncate md:inline">
          {displayName(user.name, user.email)}
        </span>
      </summary>
      <div className="absolute right-0 top-full z-30 mt-2 w-44 rounded-md border border-[var(--color-atlas-line)] bg-[var(--color-atlas-surface)] p-1.5 shadow-lg">
        <p className="truncate px-3 py-2 text-xs text-[var(--color-atlas-muted)]">
          {displayName(user.name, user.email)}
        </p>
        <button
          type="button"
          onClick={signOut}
          className="w-full rounded px-3 py-2 text-left text-sm text-[var(--color-atlas-muted)] hover:bg-[var(--color-atlas-bg)] hover:text-[var(--color-atlas-ink)]"
        >
          Sign out
        </button>
      </div>
    </details>
  );
}
