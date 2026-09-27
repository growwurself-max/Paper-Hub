export type PlatformLimits = {
  maxDailyPapers: number;
  maxActiveCollegeAdmins: number;
};

export const DEFAULT_PLATFORM_LIMITS: PlatformLimits = {
  maxDailyPapers: 0,
  maxActiveCollegeAdmins: 0,
};

export async function readPlatformLimits(client: {
  from(table: string): {
    select(columns: string): {
      in(
        column: string,
        values: string[],
      ): Promise<{
        data: Array<{ key: string; value: unknown }> | null;
        error: { message: string } | null;
      }>;
    };
  };
}): Promise<PlatformLimits> {
  const { data, error } = await client
    .from("platform_settings")
    .select("key, value")
    .in("key", ["max_daily_papers", "max_active_college_admins"]);
  if (error) throw new Error(error.message);
  const values = new Map(
    (data ?? []).map((setting) => {
      const value =
        typeof setting.value === "number"
          ? setting.value
          : typeof setting.value === "string"
            ? Number(setting.value)
            : Number((setting.value as { value?: unknown } | null)?.value);
      return [setting.key, Number.isFinite(value) ? value : 0] as const;
    }),
  );
  return {
    maxDailyPapers: values.get("max_daily_papers") ?? DEFAULT_PLATFORM_LIMITS.maxDailyPapers,
    maxActiveCollegeAdmins:
      values.get("max_active_college_admins") ?? DEFAULT_PLATFORM_LIMITS.maxActiveCollegeAdmins,
  };
}
