import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { PasswordInput } from "@/components/PasswordInput";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { claimSuperAdminIfNone } from "@/lib/superadmin.functions";

export const Route = createFileRoute("/super-admin/login")({
  head: () => ({
    meta: [
      { title: "Super Admin — Question Paper Studio" },
      { name: "description", content: "Platform administration sign in." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SuperAdminLogin,
});

function SuperAdminLogin() {
  const navigate = useNavigate();
  const claim = useServerFn(claimSuperAdminIfNone);
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    try {
      await claim();
    } catch (err) {
      console.error("claimSuperAdminIfNone failed", err);
    }
    const { data: roles, error: rolesErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id);
    setLoading(false);
    if (rolesErr) {
      setError(rolesErr.message);
      return;
    }
    if (!roles?.some((r) => r.role === "super_admin")) {
      await supabase.auth.signOut();
      setError("This account is not a super admin.");
      return;
    }
    queryClient.removeQueries({ queryKey: ["session"] });
    navigate({ to: "/super-admin" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <GlassCard className="p-8">
          <p className="text-xs font-medium uppercase tracking-widest text-accent">
            Platform administration
          </p>
          <h1 className="mt-1 text-3xl font-bold">Super admin sign in</h1>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Password</span>
              <PasswordInput
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
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
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            First time?{" "}
            <Link to="/super-admin/bootstrap" className="underline hover:text-foreground">
              Create the first super admin
            </Link>{" "}
            ·{" "}
            <Link to="/" className="underline hover:text-foreground">
              Institution sign in
            </Link>
          </p>
        </GlassCard>
      </motion.div>
    </div>
  );
}