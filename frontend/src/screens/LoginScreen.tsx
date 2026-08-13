export default function LoginScreen() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <p className="text-xs tracking-widest uppercase text-muted text-center">Nutrition &amp; Coaching</p>
        <h1 className="text-3xl font-semibold tracking-tight text-center mb-3">MacroDaddy</h1>
        <p className="text-sm text-muted text-center mb-7">Use your family account to access your private nutrition data.</p>
        <a
          href="/api/auth/oidc/start"
          className="flex w-full items-center justify-center py-3 rounded-md bg-accent text-base font-medium"
          style={{ color: "#0B1210" }}
        >
          Continue with Authentik
        </a>
        <p className="text-xs text-muted text-center mt-5 leading-relaxed">
          Logs, goals, measurements and progress photos remain isolated per account.
        </p>
      </div>
    </div>
  );
}
