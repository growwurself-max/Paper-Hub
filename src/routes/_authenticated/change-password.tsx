import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { markPasswordChanged } from "@/lib/superadmin.functions";
import { useSession } from "@/lib/useSession";
import { PasswordInput } from "@/components/PasswordInput";

export const Route = createFileRoute("/_authenticated/change-password")({
  head: () => ({
    meta: [{ title: "Change password" }, { name: "robots", content: "noindex" }],
  }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const mark = useServerFn(markPasswordChanged);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw !== pw2) {
      setError("Passwords do not match.");
      return;
    }
    if (pw.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    await mark();
    setLoading(false);
    navigate({ to: session?.role === "super_admin" ? "/super-admin" : "/dashboard" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <GlassCard className="p-8">
          <h1 className="text-2xl font-bold">Set a new password</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Please change your temporary password before continuing.
          </p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium">New password</span>
              <PasswordInput
                required
                minLength={8}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Confirm password</span>
              <PasswordInput
                required
                minLength={8}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2"
              />
            </label>
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground disabled:opacity-60"
            >
              {loading ? "Saving…" : "Update password"}
            </button>
          </form>
        </GlassCard>
      </div>
    </div>
  );
}