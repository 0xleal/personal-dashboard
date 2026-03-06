import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyJwt, SESSION_COOKIE } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";
import { RegisterForm } from "@/components/register-form";

export default async function Home() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const payload = await verifyJwt(token);
    if (payload) redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-bg bg-grid relative">
      <div className="absolute inset-0 bg-gradient-to-b from-bg via-transparent to-bg pointer-events-none" />

      <div className="relative max-w-[420px] mx-auto px-6 pt-32 pb-16">
        <div className="animate-fade-up mb-14">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="h-2 w-2 rounded-full bg-status-thinking led-active" style={{ color: "var(--color-status-thinking)" }} />
            <span className="text-[11px] uppercase tracking-[0.15em] text-text-secondary font-sans font-medium">
              Session Control
            </span>
          </div>
          <h1 className="text-[22px] font-medium leading-tight text-text-primary mb-3">
            Monitor your Claude Code sessions in real time
          </h1>
          <p className="text-[13px] leading-relaxed text-text-secondary font-sans">
            Connect your hooks and observe every session as it thinks,
            waits for input, or runs tools across your projects.
          </p>
        </div>

        <div className="stagger space-y-4">
          <div className="rounded-lg border border-border bg-surface p-5">
            <div className="flex items-center gap-2 mb-5">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-sans font-medium">
                Sign in
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <LoginForm />
          </div>

          <div className="rounded-lg border border-border bg-surface p-5">
            <div className="flex items-center gap-2 mb-5">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-sans font-medium">
                New account
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <RegisterForm />
          </div>
        </div>

        <div className="mt-8 text-center animate-fade-up" style={{ animationDelay: "300ms" }}>
          <p className="text-[11px] text-text-muted font-sans">
            Invite-only access
          </p>
        </div>
      </div>
    </main>
  );
}
