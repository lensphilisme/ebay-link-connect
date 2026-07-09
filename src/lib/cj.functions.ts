import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  cjSearchProducts,
  cjGetCategories,
  cjGetWarehouses,
  cjProductDetail,
  cjFreightCalculate,
  cjGetAccessToken,
  saveCjCreds,
  getUserCjToken,
  type CjListResponse,
  type CjProductDetail,
  type CjFreightOption,
  type CjCategoryTree,
  type CjWarehouse,
} from "./cj.server";

async function tok(ctx: any) {
  return getUserCjToken(ctx.supabase, ctx.userId);
}

export const searchCjProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { keyword?: string; categoryId?: string; pageNum?: number; pageSize?: number; countryCode?: string; minPrice?: number; maxPrice?: number; }) => data)
  .handler(async ({ data, context }: any): Promise<CjListResponse> => cjSearchProducts(data, await tok(context)));

export const getCjProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { pid: string; countryCode?: string }) => data)
  .handler(async ({ data, context }: any): Promise<CjProductDetail> => cjProductDetail(data.pid, data.countryCode, await tok(context)));

export const getCjCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any): Promise<CjCategoryTree[]> => cjGetCategories(await tok(context)));

export const getCjWarehouses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any): Promise<CjWarehouse[]> => cjGetWarehouses(await tok(context)));

export const getCjFreight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { startCountryCode?: string; endCountryCode: string; products: { vid: string; quantity: number }[]; }) => data)
  .handler(async ({ data, context }: any): Promise<CjFreightOption[]> => cjFreightCalculate(data, await tok(context)));

// The user only supplies their CJ account email + API key. The server
// immediately exchanges them for access/refresh tokens, validates them and
// stores everything. Token renewal happens automatically afterwards.
export const saveCjApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { email: string; apiKey: string }) => data)
  .handler(async ({ data, context }: any) => {
    const email = data.email?.trim();
    const apiKey = data.apiKey?.trim();
    if (!email) throw new Error("CJ account email is required");
    if (!apiKey) throw new Error("CJ API key is required");
    // Validate by fetching a fresh token pair right away.
    const t = await cjGetAccessToken(email, apiKey);
    await saveCjCreds(context.supabase, context.userId, {
      email,
      api_key: apiKey,
      access_token: t.accessToken,
      access_token_expiry: t.accessTokenExpiryDate,
      refresh_token: t.refreshToken,
      refresh_token_expiry: t.refreshTokenExpiryDate,
    });
    return { ok: true };
  });

// Reports connection status considering per-user creds first, then env fallback.
export const getIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const { data } = await context.supabase.from("integration_credentials").select("provider,is_active,last_validated_at,credentials").eq("user_id", context.userId);
    const cjRow = data?.find((r: any) => r.provider === "cj");
    const ebayRow = data?.find((r: any) => r.provider === "ebay");
    const cjUserConfigured = !!(cjRow?.is_active && (cjRow.credentials?.api_key || cjRow.credentials?.access_token));
    const cjConnected = cjUserConfigured || !!(process.env.CJ_API_KEY && process.env.CJ_EMAIL) || !!process.env.CJ_ACCESS_TOKEN;
    const ebayConnected = !!(ebayRow?.is_active && ebayRow.credentials?.refresh_token);
    return {
      cj: {
        connected: cjConnected,
        source: cjUserConfigured ? "user" : cjConnected ? "env" : null,
        last: cjRow?.last_validated_at || null,
        email: cjRow?.credentials?.email || null,
      },
      ebay: { connected: ebayConnected, source: ebayConnected ? "user" : null, last: ebayRow?.last_validated_at || null },
    };
  });
