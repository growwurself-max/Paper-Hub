import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { bootstrapSuperAdmin } from "@/lib/superadmin.functions";
import { PasswordInput } from "@/components/PasswordInput";

export const Route = createFileRoute("/super-admin/bootstrap")({
  head: () => ({
    meta: [
      { title: "Bootstrap Super Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BootstrapPage,
});

function BootstrapPage() {
  const navigate = useNavigate();
  const bootstrap = useServerFn(bootstrapSuperAdmin);
  const [allowed, setAllowed] = useState<null | boolean>(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("super_admin_exists");
      if (error) {
        setError(error.message);
        setAllowed(false);
        return;
      }
      setAllowed(!data);
    })();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await bootstrap({ data: { email, password, fullName } });
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) throw signInErr;
      navigate({ to: "/super-admin" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create super admin");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <GlassCard className="p-8">
          <h1 className="text-2xl font-bold">Create the first super admin</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This one-time setup creates the platform's super administrator account.
          </p>

          {allowed === null && (
            <p className="mt-6 text-sm text-muted-foreground">Checking platform state…</p>
          )}

          {allowed === false && (
            <div className="mt-6 space-y-4">
              <p className="rounded-md bg-muted px-3 py-2 text-sm">
                A super administrator already exists. This screen is disabled.
              </p>
              <Link
                to="/super-admin/login"
                className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Go to sign in
              </Link>
            </div>
          )}

          {allowed === true && (
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <label className="block">
                <span className="text-sm font-medium">Full name</span>
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Password (min 8 chars)</span>
                <PasswordInput
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
                {loading ? "Creating…" : "Create super admin"}
              </button>
            </form>
          )}
        </GlassCard>
      </div>
    </div>
  );
}