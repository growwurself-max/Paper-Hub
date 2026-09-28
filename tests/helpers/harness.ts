/**
 * Shared harness for the Paper Hub end-to-end journey tests.
 *
 * These are integration tests: they run against the real hosted Supabase
 * project, the real Gemini API and a real build of the app. They provision
 * their own throwaway org admin, so they never depend on (or disturb) the
 * hand-created demo accounts.
 *
 * Run with:
 *   npm run build && npm run preview        # in one shell
 *   npm test                                 # in another
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encode } from "@tanstack/router-core";
import { createPlugin, fromCrossJSON, toJSONAsync } from "seroval";

export const ORG_ID = process.env.E2E_ORG_ID ?? "00000000-0000-0000-0000-000000000001";
export const E2E_EMAIL = process.env.E2E_EMAIL ?? "e2e.institute.admin@paperhub.test";

/** The preview server started by `npm run preview`. */
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4174";

const REPO_ROOT = process.cwd();
const SERVER_ASSETS = join(REPO_ROOT, "dist", "server", "assets");
const SRC_LIB = join(REPO_ROOT, "src", "lib");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}. Run with --env-file=.env`);
  return value;
}

// Deliberately not hardcoded: these tests sign in to a real hosted Supabase
// project, so the password for the throwaway admin they provision lives in
// .env (which is gitignored) rather than in the repository.
const E2E_PASSWORD = requireEnv("E2E_PASSWORD");

export const SUPABASE_URL = requireEnv("SUPABASE_URL");
export const SERVICE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
export const PUBLISHABLE_KEY = requireEnv("SUPABASE_PUBLISHABLE_KEY");

/**
 * Mirrors createSupabaseFetch() in src/integrations/supabase/client.server.ts.
 * The new-style Supabase keys are opaque strings rather than JWTs, so a
 * `Bearer <key>` Authorization header has to be stripped before the real user
 * token is attached.
 */
function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    if (headers.get("Authorization") === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

/** Service-role client. Used only to provision the test identity. */
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * User-scoped client built exactly the way requireSupabaseAuth builds it, so
 * every query in the journey is subject to the same RLS policies the running
 * app is subject to.
 */
export function scopedClient(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: {
      fetch: createSupabaseFetch(PUBLISHABLE_KEY),
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Session = { accessToken: string; userId: string; client: SupabaseClient };

/**
 * Step 1 of the journey: institute admin login.
 *
 * Provisions the org-admin on first run (the same thing the super-admin
 * "create organization + admin" screen does), then performs a genuine password
 * sign-in and returns a client bound to that user's JWT.
 */
/**
 * Make sure the dedicated E2E organization can still generate a paper.
 *
 * Every run generates real papers through the real Gemini API, and each one
 * burns a credit against `organizations.paper_credit_balance` and counts
 * towards `paper_daily_limit`. Without this the suite silently starts failing on
 * its second or third run with a confusing "no paper credits remaining" error
 * that looks like a product bug. Only the throwaway E2E org is touched - the
 * hand-made demo accounts and their limits are left exactly as they are.
 *
 * A NULL balance and a zero daily limit both mean "unlimited" to
 * reserve_paper_generation_credit(), so the journey stays repeatable.
 */
async function ensureGenerationHeadroom(admin: SupabaseClient): Promise<void> {
  const { data, error } = await admin
    .from("organizations")
    .select("paper_credit_balance, paper_daily_limit")
    .eq("id", ORG_ID)
    .maybeSingle();
  if (error) throw new Error(`could not read the E2E organization: ${error.message}`);
  if (!data) {
    throw new Error(
      `E2E_ORG_ID ${ORG_ID} does not exist. Set E2E_ORG_ID to a real organization in .env.`,
    );
  }

  if (data.paper_credit_balance === null && data.paper_daily_limit === 0) return;

  const { error: updateError } = await admin
    .from("organizations")
    .update({ paper_credit_balance: null, paper_daily_limit: 0 })
    .eq("id", ORG_ID);
  if (updateError) {
    throw new Error(
      `could not lift the E2E generation limits: ${updateError.message}. ` +
        "Run the suite against a dedicated organization you are happy to reconfigure.",
    );
  }
}

export async function loginAsInstituteAdmin(): Promise<Session> {
  const admin = adminClient();

  await ensureGenerationHeadroom(admin);

  let signIn = await admin.auth.signInWithPassword({ email: E2E_EMAIL, password: E2E_PASSWORD });
  if (signIn.error) {
    const created = await admin.auth.admin.createUser({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "E2E Institute Admin" },
    });
    if (created.error) throw created.error;
    const userId = created.data.user!.id;

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: userId,
        organization_id: ORG_ID,
        full_name: "E2E Institute Admin",
        email: E2E_EMAIL,
        must_change_password: false,
        is_active: true,
      },
      { onConflict: "id" },
    );
    if (profileError) throw new Error(`profile provisioning failed: ${profileError.message}`);

    const { error: roleError } = await admin
      .from("user_roles")
      .upsert(
        { user_id: userId, role: "org_admin", organization_id: ORG_ID },
        { onConflict: "user_id,role" },
      );
    if (roleError) throw new Error(`role provisioning failed: ${roleError.message}`);

    signIn = await admin.auth.signInWithPassword({ email: E2E_EMAIL, password: E2E_PASSWORD });
    if (signIn.error) throw new Error(`sign-in after provisioning failed: ${signIn.error.message}`);
  }

  const accessToken = signIn.data.session!.access_token;
  const userId = signIn.data.user!.id;
  return { accessToken, userId, client: scopedClient(accessToken) };
}

/* ------------------------------------------------------------------ *
 * Server function transport
 * ------------------------------------------------------------------ */

export type ServerFnModule =
  | "paper.functions"
  | "syllabus.functions"
  | "templates.functions"
  | "omr-package.functions"
  | "scoring.functions"
  | "superadmin.functions"
  | "credits.functions";

const idCache = new Map<ServerFnModule, Record<string, string>>();

/**
 * Index every server function id emitted into the server build, keyed by
 * `<module>#<exportName>`.
 *
 * In a production build a server function is addressed by a hash rather than by
 * its dev-mode base64 descriptor. The server chunks carry that hash alongside
 * the source filename and the export name, which is authoritative and - unlike
 * counting hashes in the client chunk - works for server-only modules that the
 * client bundle tree-shakes away entirely.
 */
let idIndex: Map<string, string> | null = null;

function buildIdIndex(): Map<string, string> {
  if (idIndex) return idIndex;

  if (!existsSync(SERVER_ASSETS)) {
    throw new Error(`Missing ${SERVER_ASSETS}. Run \`npm run build\` before the e2e tests.`);
  }

  const index = new Map<string, string>();
  for (const file of readdirSync(SERVER_ASSETS)) {
    if (!file.endsWith(".js")) continue;
    const source = readFileSync(join(SERVER_ASSETS, file), "utf8");
    for (const match of source.matchAll(
      /id:\s*"([0-9a-f]{64})",\s*name:\s*"(\w+)",\s*filename:\s*"src\/lib\/([\w.-]+)\.ts"/g,
    )) {
      index.set(`${match[3]}#${match[2]}`, match[1]);
    }
  }

  if (index.size === 0) {
    throw new Error(
      `No server function ids found under ${SERVER_ASSETS}. Re-run \`npm run build\`.`,
    );
  }
  idIndex = index;
  return index;
}

/**
 * Resolve the build-time hashes TanStack Start assigns to each server function.
 *
 * Every id is looked up by export name, so a module gaining or losing a function
 * cannot silently shift another function's id the way positional matching would.
 */
export function resolveFunctionIds(module: ServerFnModule): Record<string, string> {
  const cached = idCache.get(module);
  if (cached) return cached;

  const index = buildIdIndex();
  const source = existsSync(join(SRC_LIB, `${module}.ts`))
    ? readFileSync(join(SRC_LIB, `${module}.ts`), "utf8")
    : "";
  const exportNames = [...source.matchAll(/export const (\w+) = createServerFn/g)].map((m) => m[1]);

  const map: Record<string, string> = {};
  for (const name of exportNames) {
    const id = index.get(`${module}#${name}`);
    if (id) map[name] = id;
  }

  if (exportNames.length === 0) {
    throw new Error(`No \`createServerFn\` exports found in src/lib/${module}.ts`);
  }

  // A module no route imports is tree-shaken out of the build, so its ids are
  // legitimately absent. Say so rather than reporting a generic miss.
  const missing = exportNames.filter((name) => !map[name]);
  if (missing.length === exportNames.length) {
    throw new Error(
      `src/lib/${module}.ts is not part of the build, so none of its server functions ` +
        `(${exportNames.join(", ")}) can be called. No route imports it.`,
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing build ids for ${module}: ${missing.join(", ")}. Re-run \`npm run build\`.`,
    );
  }

  idCache.set(module, map);
  return map;
}

const TSS_ACCEPT = "application/x-tss-framed, application/x-ndjson, application/json";

/**
 * Server functions report a thrown handler by serializing the Error under the
 * `$TSR/Error` tag rather than by using a non-2xx status, so decoding the reply
 * without this plugin silently drops the error and the failure looks like a
 * success. This mirrors the framework's own ShallowErrorPlugin, which is not
 * reachable from outside the Start server runtime.
 */
const ErrorPlugin = createPlugin({
  tag: "$TSR/Error",
  test(value: unknown) {
    return value instanceof Error;
  },
  parse: {
    sync(value: Error, ctx) {
      return { message: ctx.parse(value.message) };
    },
    async async(value: Error, ctx) {
      return { message: await ctx.parse(value.message) };
    },
    stream(value: Error, ctx) {
      return { message: ctx.parse(value.message) };
    },
  },
  serialize(node: { message: unknown }, ctx) {
    return "new Error(" + ctx.serialize(node.message) + ")";
  },
  deserialize(node: { message: unknown }, ctx) {
    return new Error(ctx.deserialize(node.message));
  },
});

export type RpcResult<T> = { status: number; body: unknown; raw: string };

/** The `{ result, error, context }` envelope every server function replies with. */
export type RpcEnvelope<T> = { result?: T; error?: Error; context?: Record<string, unknown> };

/** True when a server function reported a failure (either shape). */
export function isError(result: RpcResult<unknown>): boolean {
  if (result.status >= 400) return true;
  const body = result.body as RpcEnvelope<unknown> | null;
  if (body && typeof body === "object") {
    if (body.error instanceof Error) return true;
    if (body instanceof Error) return true;
  }
  return result.body instanceof Error;
}

/** The failure message a server function reported, or undefined if it succeeded. */
export function errorMessage(result: RpcResult<unknown>): string | undefined {
  if (result.status >= 400) return `HTTP ${result.status}: ${result.raw.slice(0, 300)}`;
  const body = result.body as RpcEnvelope<unknown> | null;
  if (body && typeof body === "object" && body.error instanceof Error) return body.error.message;
  if (result.body instanceof Error) return result.body.message;
  return undefined;
}

/**
 * Invoke a real server function on the running server.
 *
 * This speaks TanStack Start's server-function transport: the `x-tsr-serverFn`
 * header marks the request as an RPC, and payloads/responses are seroval
 * cross-JSON rather than plain JSON (see serverFnFetcher in start-client-core).
 */
export async function callServerFn<T = unknown>(
  module: ServerFnModule,
  exportName: string,
  opts: { method?: "GET" | "POST"; body?: unknown; token: string },
): Promise<RpcResult<T>> {
  const ids = resolveFunctionIds(module);
  const id = ids[exportName];
  if (!id) {
    throw new Error(
      `Unknown server function ${module}.${exportName}. Known: ${Object.keys(ids).join(", ")}`,
    );
  }

  const method = opts.method ?? "POST";
  let url = `${BASE_URL}/_serverFn/${id}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.token}`,
    "x-tsr-serverFn": "true",
    accept: TSS_ACCEPT,
    // src/start.ts installs createCsrfMiddleware over every serverFn, which
    // rejects requests that carry no Sec-Fetch-Site/Origin/Referer. A real
    // browser always sends a same-origin Origin, so the tests do too.
    Origin: BASE_URL,
    "Sec-Fetch-Site": "same-origin",
  };

  let body: string | undefined;
  if (opts.body !== undefined) {
    const serialized = JSON.stringify(await toJSONAsync({ data: opts.body }));
    if (method === "GET") {
      // Server functions declared with method:"GET" take their input from the
      // query string, encoded by router-core's encode().
      url += `?${encode({ payload: serialized })}`;
    } else {
      body = serialized;
      headers["content-type"] = "application/json";
    }
  }

  const res = await fetch(url, { method, headers, body });
  const raw = await res.text();

  let parsed: unknown = raw;
  if (res.headers.get("x-tss-serialized")) {
    try {
      parsed = fromCrossJSON(JSON.parse(raw), { plugins: [ErrorPlugin] });
    } catch {
      /* fall through to raw text */
    }
  } else if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* leave as text */
    }
  }
  return { status: res.status, body: parsed, raw };
}

/**
 * Assert a server-function call succeeded and return its `result`.
 */
export function unwrap<T>(result: RpcResult<unknown>): T {
  const failure = errorMessage(result);
  if (failure !== undefined) {
    throw new Error(`server function failed: ${failure}`);
  }
  const body = result.body as RpcEnvelope<T> | null;
  if (body && typeof body === "object" && "result" in body) {
    return body.result as T;
  }
  return result.body as T;
}

/** Call a server function and return its result, asserting success. */
export async function callOk<T>(
  module: ServerFnModule,
  exportName: string,
  opts: { method?: "GET" | "POST"; body?: unknown; token: string },
): Promise<T> {
  return unwrap<T>(await callServerFn<T>(module, exportName, opts));
}

/**
 * Assert a server function *rejected* the call, returning the message it gave.
 * Use this for the negative paths - quota, validation and RLS denials - which
 * the transport reports as a 200 carrying a serialized Error.
 */
export async function expectRejection(
  module: ServerFnModule,
  exportName: string,
  opts: { method?: "GET" | "POST"; body?: unknown; token: string },
): Promise<string> {
  const result = await callServerFn(module, exportName, opts);
  const failure = errorMessage(result);
  if (failure === undefined) {
    throw new Error(
      `expected ${module}.${exportName} to fail, but it succeeded with ${JSON.stringify(result.body).slice(0, 200)}`,
    );
  }
  return failure;
}
