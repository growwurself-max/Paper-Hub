import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SessionInfo = {
  userId: string;
  email: string | null;
  role: "super_admin" | "org_admin" | null;
  organizationId: string | null;
  fullName: string;
  mustChangePassword: boolean;
  isActive: boolean;
} | null;

export function useSession() {
  return useQuery<SessionInfo>({
    queryKey: ["session"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) return null;

      const [{ data: profile, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, organization_id, must_change_password, is_active, email")
          .eq("id", user.id)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);

      if (pErr) throw pErr;
      if (rErr) throw rErr;

      const role =
        roles?.find((r) => r.role === "super_admin")?.role ??
        roles?.find((r) => r.role === "org_admin")?.role ??
        null;

      return {
        userId: user.id,
        email: user.email ?? profile?.email ?? null,
        role: (role as "super_admin" | "org_admin" | null) ?? null,
        organizationId: profile?.organization_id ?? null,
        fullName: profile?.full_name ?? "",
        mustChangePassword: profile?.must_change_password ?? false,
        // Super admins are never blocked by the org "inactive" gate.
        isActive: role === "super_admin" ? true : (profile?.is_active ?? true),
      };
    },
    staleTime: 30_000,
  });
}