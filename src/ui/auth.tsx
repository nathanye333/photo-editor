import type { OAuthProvider } from "../auth/AuthContext";

export function SignInScreen(props: {
  configured: boolean;
  busy?: boolean;
  error?: string | null;
  onSignIn: (provider: OAuthProvider) => void;
}) {
  return (
    <div className="auth-screen">
      <div className="auth-panel">
        <h1 className="auth-brand">Field</h1>
        <p className="auth-lede">
          Sign in to store your catalog, develop recipes, and photo blobs in your account.
        </p>
        {!props.configured ? (
          <p className="auth-error">
            Supabase is not configured. Set <code>VITE_SUPABASE_URL</code> and{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> (or <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>), then
            apply <code>supabase/migrations</code>.
          </p>
        ) : (
          <div className="auth-actions">
            <button
              type="button"
              className="auth-btn"
              disabled={props.busy}
              onClick={() => props.onSignIn("google")}
            >
              Continue with Google
            </button>
            <button
              type="button"
              className="auth-btn secondary"
              disabled={props.busy}
              onClick={() => props.onSignIn("github")}
            >
              Continue with GitHub
            </button>
          </div>
        )}
        {props.error ? <p className="auth-error">{props.error}</p> : null}
      </div>
    </div>
  );
}

export function AccountChip(props: {
  email?: string | null;
  onSignOut: () => void;
}) {
  return (
    <span className="account-chip">
      <span className="account-email" title={props.email ?? undefined}>
        {props.email ?? "Signed in"}
      </span>
      <button type="button" onClick={props.onSignOut}>
        Sign out
      </button>
    </span>
  );
}
