// Server-only CJ Dropshipping Open API client.
// Docs: https://developers.cjdropshipping.com/en/api/

const CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1";

type CjEnvelope<T> = { code: number; result?: boolean; success?: boolean; message: string; data: T };

async function cjFetch<T>(path: string, init: RequestInit = {}, overrideToken?: string): Promise<T> {
  const token = overrideToken || process.env.CJ_ACCESS_TOKEN;
  if (!token) throw new Error("CJ access token is not configured. Add it under Settings → CJ Dropshipping.");
  const res = await fetch(`${CJ_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "CJ-Access-Token": token,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json: CjEnvelope<T>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`CJ non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (json.result === false || json.success === false || (json.code && json.code !== 200)) {
    throw new Error(`CJ error ${json.code}: ${json.message}`);
  }
  return json.data;
}

// ============ CJ auth (automatic token lifecycle) ============
// The user only ever supplies email + API key. The system exchanges them for
// an access token, refreshes it when it expires, and re-authenticates when the
// refresh token itself expires — all in the background, persisted per user.

export type CjAuthTokens = {
  accessToken: string;
  accessTokenExpiryDate?: string;
  refreshToken?: string;
  refreshTokenExpiryDate?: string;
};

export async function cjGetAccessToken(email: string, apiKey: string): Promise<CjAuthTokens> {
  return cjAuthPost("/authentication/getAccessToken", { email, password: apiKey });
}

export async function cjRefreshAccessToken(refreshToken: string): Promise<CjAuthTokens> {
  return cjAuthPost("/authentication/refreshAccessToken", { refreshToken });
}

async function cjAuthPost(path: string, body: Record<string, string>): Promise<CjAuthTokens> {
  const res = await fetch(`${CJ_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: CjEnvelope<CjAuthTokens>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`CJ auth non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (json.result === false || json.success === false || (json.code && json.code !== 200) || !json.data?.accessToken) {
    throw new Error(`CJ auth error ${json.code}: ${json.message}`);
  }
  return json.data;
}

type CjStoredCreds = {
  email?: string;
  api_key?: string;
  access_token?: string;
  access_token_expiry?: string;
  refresh_token?: string;
  refresh_token_expiry?: string;
};

function isStillValid(expiry?: string, marginMs = 10 * 60 * 1000): boolean {
  if (!expiry) return false;
  const t = new Date(expiry).getTime();
  return Number.isFinite(t) && t - marginMs > Date.now();
}

export async function saveCjCreds(supabase: any, userId: string, creds: CjStoredCreds): Promise<void> {
  const row = {
    user_id: userId,
    provider: "cj",
    label: "default",
    environment: "production",
    is_active: true,
    last_validated_at: new Date().toISOString(),
    last_error: null,
    credentials: creds,
  };
  const { data: existing } = await supabase
    .from("integration_credentials").select("id")
    .eq("user_id", userId).eq("provider", "cj").eq("label", "default").maybeSingle();
  if (existing?.id) await supabase.from("integration_credentials").update(row).eq("id", existing.id);
  else await supabase.from("integration_credentials").insert(row);
}

async function readCjCreds(supabase: any, userId: string): Promise<CjStoredCreds> {
  const { data } = await supabase
    .from("integration_credentials")
    .select("credentials")
    .eq("user_id", userId)
    .eq("provider", "cj")
    .eq("label", "default")
    .maybeSingle();
  return (data?.credentials as CjStoredCreds) || {};
}

/**
 * Returns a valid CJ access token for the user, transparently:
 * 1. cached access token if not expired
 * 2. refresh-token exchange if the access token expired
 * 3. full re-auth with email + API key if the refresh token also expired
 * New tokens are saved back to the database in the background.
 * Falls back to workspace-level env credentials (CJ_EMAIL / CJ_API_KEY /
 * CJ_ACCESS_TOKEN / CJ_REFRESH_TOKEN) when the user has none stored.
 */
export async function getUserCjToken(supabase: any, userId: string): Promise<string | undefined> {
  const stored = await readCjCreds(supabase, userId);
  const email = stored.email || process.env.CJ_EMAIL;
  const apiKey = stored.api_key || process.env.CJ_API_KEY;

  // 1) cached, still-valid access token
  if (stored.access_token && isStillValid(stored.access_token_expiry)) {
    return stored.access_token;
  }

  // 2) try refresh token (stored first, then env)
  const refreshCandidates = [
    stored.refresh_token && (!stored.refresh_token_expiry || isStillValid(stored.refresh_token_expiry)) ? stored.refresh_token : undefined,
    process.env.CJ_REFRESH_TOKEN,
  ].filter(Boolean) as string[];

  for (const rt of refreshCandidates) {
    try {
      const t = await cjRefreshAccessToken(rt);
      await saveCjCreds(supabase, userId, {
        email, api_key: apiKey,
        access_token: t.accessToken,
        access_token_expiry: t.accessTokenExpiryDate,
        refresh_token: t.refreshToken || rt,
        refresh_token_expiry: t.refreshTokenExpiryDate,
      });
      return t.accessToken;
    } catch {
      // refresh token expired/invalid — fall through to full re-auth
    }
  }

  // 3) full re-auth with email + API key
  if (email && apiKey) {
    try {
      const t = await cjGetAccessToken(email, apiKey);
      await saveCjCreds(supabase, userId, {
        email, api_key: apiKey,
        access_token: t.accessToken,
        access_token_expiry: t.accessTokenExpiryDate,
        refresh_token: t.refreshToken,
        refresh_token_expiry: t.refreshTokenExpiryDate,
      });
      return t.accessToken;
    } catch (e) {
      // CJ rate-limits getAccessToken (1 call / 5 min); fall back to any token we still have
      const fallback = stored.access_token || process.env.CJ_ACCESS_TOKEN;
      if (fallback) return fallback;
      throw e;
    }
  }

  // last resort: stale stored token or workspace token
  return stored.access_token || process.env.CJ_ACCESS_TOKEN;
}

export type CjCategoryTree = {
  categoryFirstName: string;
  categoryFirstList?: {
    categorySecondName: string;
    categorySecondList?: { categoryId: string; categoryName: string }[];
  }[];
};

export type CjWarehouse = {
  countryCode: string;
  nameEn?: string;
  areaEn?: string;
  valueEn?: string;
  disabled?: boolean;
};

export type CjListItem = {
  pid: string;
  productNameEn: string;
  productSku: string;
  productImage: string;
  sellPrice: number | string;
  productWeight?: number | string;
  productType?: string;
  categoryName?: string;
  categoryId?: string;
  listedNum?: number;
  supplierName?: string;
  createrTime?: string;
};

export type CjListResponse = {
  pageNum: number;
  pageSize: number;
  total: number;
  list: CjListItem[];
};

export async function cjSearchProducts(params: {
  keyword?: string;
  categoryId?: string;
  categoryIds?: string[];
  pageNum?: number;
  pageSize?: number;
  countryCode?: string;
  minPrice?: number;
  maxPrice?: number;
}, token?: string): Promise<CjListResponse> {
  const ids = Array.from(new Set((params.categoryIds ?? []).filter(Boolean)));
  const buildQs = (categoryId?: string, pageNum = params.pageNum ?? 1, pageSize = params.pageSize ?? 20) => {
    const q = new URLSearchParams();
    q.set("pageNum", String(pageNum));
    q.set("pageSize", String(pageSize));
    if (params.keyword) q.set("productNameEn", params.keyword);
    if (categoryId) q.set("categoryId", categoryId);
    if (params.countryCode) q.set("countryCode", params.countryCode);
    if (params.minPrice != null) q.set("minPrice", String(params.minPrice));
    if (params.maxPrice != null) q.set("maxPrice", String(params.maxPrice));
    return q.toString();
  };

  // CJ /product/list is GET-only (POST returns error 16900202: "Request method
  // 'POST' not supported"). For multi-category selection, fan out one GET per
  // category in parallel and merge/dedupe by pid.
  if (ids.length > 1) {
    const pageSize = params.pageSize ?? 20;
    const perCat = Math.max(pageSize, 20);
    const results = await Promise.all(
      ids.map((id) => cjFetch<CjListResponse>(`/product/list?${buildQs(id, 1, perCat)}`, {}, token).catch(() => null)),
    );
    const seen = new Set<string>();
    const merged: CjListItem[] = [];
    let total = 0;
    for (const r of results) {
      if (!r) continue;
      total += Number(r.total ?? 0);
      for (const it of r.list ?? []) {
        if (!it?.pid || seen.has(it.pid)) continue;
        seen.add(it.pid);
        merged.push(it);
      }
    }
    const pageNum = params.pageNum ?? 1;
    const start = (pageNum - 1) * pageSize;
    return { pageNum, pageSize, total: total || merged.length, list: merged.slice(start, start + pageSize) };
  }

  const singleId = ids[0] || params.categoryId;
  return cjFetch<CjListResponse>(`/product/list?${buildQs(singleId)}`, {}, token);
}

export type CjVariant = {
  vid: string;
  variantNameEn?: string;
  variantSku?: string;
  variantImage?: string;
  variantSellPrice?: number | string;
  variantWeight?: number | string;
  variantLength?: number | string;
  variantWidth?: number | string;
  variantHeight?: number | string;
  variantKey?: string; // e.g. "Red-XL"
  inventory?: number;
};

export type CjProductDetail = {
  pid: string;
  productNameEn: string;
  productSku: string;
  bigImage?: string;
  productImage: string;
  productImageSet?: string[];
  productImages?: string[];
  description?: string;
  sellPrice: number | string;
  productWeight?: number | string;
  categoryId?: string;
  categoryName?: string;
  productType?: string;
  productKeyEn?: string;
  productProEnSet?: string[];
  packingWeight?: string | number;
  variants?: CjVariant[];
  // some endpoints return "variantList" or "productVariants"
  variantList?: CjVariant[];
  productVariants?: CjVariant[];
};

export async function cjGetCategories(token?: string): Promise<CjCategoryTree[]> {
  return cjFetch<CjCategoryTree[]>("/product/getCategory", {}, token);
}

export async function cjGetWarehouses(token?: string): Promise<CjWarehouse[]> {
  return cjFetch<CjWarehouse[]>("/product/globalWarehouseList", {}, token);
}

export async function cjProductDetail(pid: string, countryCode?: string, token?: string): Promise<CjProductDetail> {
  const q = new URLSearchParams({ pid, features: "enable_combine,enable_video" });
  if (countryCode) q.set("countryCode", countryCode);
  return cjFetch<CjProductDetail>(`/product/query?${q}`, {}, token);
}

export type CjFreightOption = {
  logisticName: string;
  logisticPrice: number;
  logisticAging: string;
  logisticWeight?: number;
  trackInfo?: string;
};

export async function cjFreightCalculate(params: {
  startCountryCode?: string;
  endCountryCode: string;
  products: { vid: string; quantity: number }[];
}, token?: string): Promise<CjFreightOption[]> {
  const body = {
    startCountryCode: params.startCountryCode ?? "CN",
    endCountryCode: params.endCountryCode,
    products: params.products,
  };
  return cjFetch<CjFreightOption[]>("/logistic/freightCalculate", {
    method: "POST",
    body: JSON.stringify(body),
  }, token);
}

// Real per-variant stock lookup. CJ's /product/query endpoint does not return
// inventory reliably; the dedicated stock endpoint does. Returns a map of
// vid → available units. Never throws — a missing endpoint just yields {}.
export async function cjGetProductStock(pid: string, token?: string): Promise<Record<string, number>> {
  try {
    const q = new URLSearchParams({ pid });
    const res: any = await cjFetch<any>(`/product/stock/queryByPid?${q}`, {}, token);
    const list: any[] = Array.isArray(res)
      ? res
      : res?.variantList || res?.list || res?.variants || res?.data || [];
    const out: Record<string, number> = {};
    for (const v of list) {
      const vid = String(v?.vid || v?.variantVid || v?.variantId || "");
      const num = Number(v?.storageNum ?? v?.stockNum ?? v?.inventory ?? v?.availableQuantity ?? v?.availableNum ?? v?.available ?? 0);
      if (vid && Number.isFinite(num) && num >= 0) out[vid] = num;
    }
    return out;
  } catch { return {}; }
}

