"use client";

import { useActionState, useState } from "react";
import { register, AuthState } from "@/app/actions";

export function RegisterForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    register,
    null
  );
  const [copied, setCopied] = useState(false);

  if (state?.apiKey) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-success" />
          <span className="text-[13px] text-success font-sans font-medium">
            Account created
          </span>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-[0.1em] text-text-secondary font-sans mb-1.5">
            Your API Key — save it now, shown once only
          </label>
          <div className="flex gap-2">
            <code className="flex-1 rounded border border-border bg-bg px-3 py-2.5 text-[12px] text-status-thinking break-all leading-relaxed">
              {state.apiKey}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(state.apiKey!);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="rounded border border-border bg-bg px-3 py-2.5 text-[11px] uppercase tracking-[0.1em] text-text-secondary hover:text-text-primary hover:border-accent transition-colors shrink-0 font-sans"
            >
              {copied ? "Done" : "Copy"}
            </button>
          </div>
        </div>
        <p className="text-[12px] text-text-muted font-sans leading-relaxed">
          Use this key to authenticate and configure your Claude Code hooks
          with <code className="text-text-secondary">Authorization: Bearer &lt;key&gt;</code>
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <div>
        <label
          htmlFor="reg-invite"
          className="block text-[11px] uppercase tracking-[0.1em] text-text-secondary font-sans mb-1.5"
        >
          Invite Code
        </label>
        <input
          id="reg-invite"
          name="invite_code"
          type="text"
          required
          className="w-full rounded border border-border bg-bg px-3 py-2 text-[13px] text-text-primary placeholder-text-muted focus:border-accent"
          placeholder="your-invite-code"
        />
      </div>
      <div>
        <label
          htmlFor="reg-username"
          className="block text-[11px] uppercase tracking-[0.1em] text-text-secondary font-sans mb-1.5"
        >
          Username
        </label>
        <input
          id="reg-username"
          name="username"
          type="text"
          required
          autoComplete="username"
          className="w-full rounded border border-border bg-bg px-3 py-2 text-[13px] text-text-primary placeholder-text-muted focus:border-accent"
          placeholder="pick-a-username"
        />
      </div>
      {state?.error && (
        <p className="text-[12px] text-error font-sans">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded border border-border bg-surface-raised px-3 py-2.5 text-[13px] font-medium font-sans text-text-primary hover:bg-border hover:border-text-muted disabled:opacity-40 transition-colors mt-1"
      >
        {pending ? "Creating..." : "Create account"}
      </button>
    </form>
  );
}
