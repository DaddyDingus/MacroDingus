import { useState } from "react";
import { useLogin, useOidcConfig, useSignup } from "../api/auth";
import { ApiError } from "../api/client";

// Surfaced by the OIDC callback when it bounces back without a session, so a
// failed sign-in explains itself instead of silently returning to the form.
const SSO_MESSAGES: Record<string, string> = {
  failed: "Single sign-on didn't complete. Try again, or log in with your password.",
  denied: "That account isn't allowed to use this app.",
  unavailable: "Single sign-on is unreachable right now. Log in with your password.",
};

export default function LoginScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const oidc = useOidcConfig();

  const ssoError = SSO_MESSAGES[new URLSearchParams(window.location.search).get("sso") ?? ""];

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <p className="text-xs tracking-widest uppercase text-muted text-center">Nutrition &amp; Coaching</p>
        <h1 className="text-3xl font-semibold tracking-tight text-center mb-8">macrotrack</h1>

        {ssoError && <p className="text-sm text-protein text-center mb-4">{ssoError}</p>}

        {mode === "login" && oidc.data?.enabled && (
          <>
            {/* A plain link, not fetch(): this is a full-page navigation to
                the identity provider. An XHR would be blocked by CORS and
                could not carry the browser through the redirect chain. */}
            <a
              href="/api/auth/oidc/start"
              className="block w-full py-3 rounded-md bg-accent text-base font-medium text-center"
              style={{ color: "#0B1210" }}
            >
              Sign in with {oidc.data.providerName ?? "SSO"}
            </a>
            <div className="flex items-center gap-3 my-5">
              <span className="h-px flex-1 bg-line" />
              <span className="text-xs text-muted">or</span>
              <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}

        {mode === "login" ? <LoginForm ssoEnabled={oidc.data?.enabled ?? false} /> : <SignupForm />}

        <button
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
          className="w-full text-center text-sm text-muted mt-5"
        >
          {mode === "login" ? (
            <>
              New here? <span className="text-accent">Create an account</span>
            </>
          ) : (
            <>
              Already have an account? <span className="text-accent">Log in</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function LoginForm({ ssoEnabled }: { ssoEnabled: boolean }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();

  const canSubmit = name.trim().length > 0 && password.length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    login.mutate({ name: name.trim(), password });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        autoFocus
        name="username"
        autoComplete="username"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        className="w-full rounded-md bg-surface border border-line px-4 py-3 text-sm text-center focus:outline-none focus:border-accent"
      />
      <input
        type="password"
        name="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="w-full rounded-md bg-surface border border-line px-4 py-3 text-sm text-center focus:outline-none focus:border-accent"
      />

      {/* Deliberately generic: the server never says which field was wrong,
          and neither should this. A "no such user" message here would undo
          the enumeration protection on the API. */}
      {login.isError && (
        <p className="text-sm text-protein text-center">
          {login.error instanceof ApiError && login.error.status === 429
            ? "Too many attempts. Wait a few minutes and try again."
            : "Incorrect name or password."}
        </p>
      )}

      {/* When SSO is the normal way in, the local form is the fallback for
          when the provider is down — so it must not compete visually with
          the primary button above it. */}
      <button
        type="submit"
        disabled={login.isPending || !canSubmit}
        className={
          ssoEnabled
            ? "w-full py-3 rounded-md border border-line text-base font-medium disabled:opacity-40"
            : "w-full py-3 rounded-md bg-accent text-base font-medium disabled:opacity-40"
        }
        style={ssoEnabled ? undefined : { color: "#0B1210" }}
      >
        {login.isPending ? "Checking…" : "Log in"}
      </button>
    </form>
  );
}

function SignupForm() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const signup = useSignup();

  const passwordTooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = name.trim().length > 0 && password.length >= 8 && password === confirm;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    signup.mutate({ name: name.trim(), password });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        autoFocus
        name="name"
        autoComplete="off"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        className="w-full rounded-md bg-surface border border-line px-4 py-3 text-sm text-center focus:outline-none focus:border-accent"
      />
      <input
        type="password"
        name="new-password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password (min. 8 characters)"
        className="w-full rounded-md bg-surface border border-line px-4 py-3 text-sm text-center focus:outline-none focus:border-accent"
      />
      <input
        type="password"
        name="confirm-password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Confirm password"
        className="w-full rounded-md bg-surface border border-line px-4 py-3 text-sm text-center focus:outline-none focus:border-accent"
      />

      {passwordTooShort && <p className="text-xs text-muted text-center">At least 8 characters.</p>}
      {mismatch && <p className="text-xs text-muted text-center">Passwords don't match.</p>}
      {signup.isError && (
        <p className="text-sm text-protein text-center">
          {signup.error instanceof ApiError ? signup.error.message : "Something went wrong."}
        </p>
      )}

      <button
        type="submit"
        disabled={signup.isPending || !canSubmit}
        className="w-full py-3 rounded-md bg-accent text-base font-medium disabled:opacity-40"
        style={{ color: "#0B1210" }}
      >
        {signup.isPending ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
