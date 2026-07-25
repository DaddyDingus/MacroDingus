import { useState } from "react";
import { useLogin, useSignup } from "../api/auth";
import { ApiError } from "../api/client";

export default function LoginScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <p className="text-xs tracking-widest uppercase text-muted text-center">Nutrition &amp; Coaching</p>
        <h1 className="text-3xl font-semibold tracking-tight text-center mb-8">macrotrack</h1>

        {mode === "login" ? <LoginForm /> : <SignupForm />}

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

function LoginForm() {
  const [password, setPassword] = useState("");
  const login = useLogin();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    login.mutate(password);
  }

  return (
    <form onSubmit={submit}>
      <input
        autoFocus
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="w-full rounded-md bg-surface border border-line px-4 py-3 text-sm text-center focus:outline-none focus:border-accent"
      />

      {login.isError && <p className="text-sm text-protein text-center mt-3">Incorrect password.</p>}

      <button
        type="submit"
        disabled={login.isPending || !password}
        className="w-full mt-4 py-3 rounded-md bg-accent text-base font-medium disabled:opacity-40"
        style={{ color: "#0B1210" }}
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
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        className="w-full rounded-md bg-surface border border-line px-4 py-3 text-sm text-center focus:outline-none focus:border-accent"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password (min. 8 characters)"
        className="w-full rounded-md bg-surface border border-line px-4 py-3 text-sm text-center focus:outline-none focus:border-accent"
      />
      <input
        type="password"
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
