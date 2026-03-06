"use client";

import { useActionState } from "react";
import { login, AuthState } from "@/app/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    login,
    null
  );

  return (
    <form action={action} className="space-y-3">
      <div>
        <label
          htmlFor="login-username"
          className="block text-[11px] uppercase tracking-[0.1em] text-text-secondary font-sans mb-1.5"
        >
          Username
        </label>
        <input
          id="login-username"
          name="username"
          type="text"
          required
          autoComplete="username"
          className="w-full rounded border border-border bg-bg px-3 py-2 text-[13px] text-text-primary placeholder-text-muted focus:border-accent"
          placeholder="your-username"
        />
      </div>
      <div>
        <label
          htmlFor="login-api-key"
          className="block text-[11px] uppercase tracking-[0.1em] text-text-secondary font-sans mb-1.5"
        >
          API Key
        </label>
        <input
          id="login-api-key"
          name="api_key"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded border border-border bg-bg px-3 py-2 text-[13px] text-text-primary placeholder-text-muted focus:border-accent"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
      </div>
      {state?.error && (
        <p className="text-[12px] text-error font-sans">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-accent px-3 py-2.5 text-[13px] font-medium font-sans text-white hover:bg-accent-hover disabled:opacity-40 transition-colors mt-1"
      >
        {pending ? "Authenticating..." : "Authenticate"}
      </button>
    </form>
  );
}
