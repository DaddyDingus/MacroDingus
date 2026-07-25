import { useState } from "react";
import { useLogin } from "../api/auth";

export default function LoginScreen() {
  const [password, setPassword] = useState("");
  const login = useLogin();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    login.mutate(password);
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <p className="text-xs tracking-widest uppercase text-muted text-center">Nutrition &amp; Coaching</p>
        <h1 className="text-3xl font-semibold tracking-tight text-center mb-8">macrotrack</h1>

        <input
          autoFocus
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-md bg-surface border border-line px-4 py-3 text-sm text-center focus:outline-none focus:border-accent"
        />

        {login.isError && (
          <p className="text-sm text-protein text-center mt-3">Incorrect password.</p>
        )}

        <button
          type="submit"
          disabled={login.isPending || !password}
          className="w-full mt-4 py-3 rounded-md bg-accent text-base font-medium disabled:opacity-40"
          style={{ color: "#0B1210" }}
        >
          {login.isPending ? "Checking…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
