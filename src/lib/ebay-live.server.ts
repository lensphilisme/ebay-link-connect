// Pure helpers for live eBay API calls — no DB access here.

const EBAY_API_BASE = process.env.EBAY_API_BASE || "https://api.ebay.com";
const EBAY_FINANCES_BASE = process.env.EBAY_FINANCES_BASE || "https://apiz.ebay.com";
const EBAY_TRADING_ENDPOINT = "https://api.ebay.com/ws/api.dll";

const RECONNECT = "Reconnect this eBay account in Settings → eBay accounts to grant the new permission.";

function scopeHint(status: number, json: any) {
  const msg = json?.errors?.[0]?.message || json?.message || "";
  if (status === 401 || status === 403 || /access denied|insufficient/i.test(msg)) {
    return `Access denied. ${RECONNECT}`;
  }
  return msg || `HTTP ${status}`;
}

function financeHint(status: number, json: any) {
  const msg = json?.errors?.[0]?.message || json?.message || "";
  if (status === 401 || status === 403) return `Access denied. ${RECONNECT}`;
  if (status === 404) return "No payouts data for this account yet (Finances requires eBay managed payments).";
  return msg || `HTTP ${status}`;
}


function tag(xml: string, name: string) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() || "";
}

export type LiveListing = {
  itemId: string;
  title: string;
  sku: string;
  price: number;
  currency: string;
  quantity: number;
  quantitySold: number;
  watchers: number;
  imageUrl?: string;
  listedAt?: string;
  url: string;
  ageDays: number;
};

export async function tradingCall(accessToken: string, callName: string, body: string) {
  const res = await fetch(EBAY_TRADING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1451",
      "X-EBAY-API-IAF-TOKEN": accessToken,
    },
    body,
  });
  const text = await res.text();
  if (!res.ok || /<Ack>(Failure|PartialFailure)<\/Ack>/i.test(text)) {
    throw new Error(`eBay ${callName} error: ${tag(text, "LongMessage") || res.statusText}`);
  }
  return text;
}

export async function fetchLiveListings(accessToken: string, perPage = 200): Promise<LiveListing[]> {
  const items: LiveListing[] = [];
  let page = 1;
  while (page <= 25) {
    const body = `<?xml version="1.0" encoding="utf-8"?>
    <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
      <ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel>
      <ActiveList><Include>true</Include><Pagination><EntriesPerPage>${perPage}</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList>
      <DetailLevel>ReturnAll</DetailLevel>
    </GetMyeBaySellingRequest>`;
    const text = await tradingCall(accessToken, "GetMyeBaySelling", body);
    const total = Number(tag(text, "TotalNumberOfEntries") || 0);
    const rows = [...text.matchAll(/<Item>([\s\S]*?)<\/Item>/g)];
    for (const m of rows) {
      const node = m[1];
      const listedAt = tag(node, "StartTime");
      const ageDays = listedAt ? Math.floor((Date.now() - new Date(listedAt).getTime()) / 86400000) : 0;
      items.push({
        itemId: tag(node, "ItemID"),
        title: tag(node, "Title"),
        sku: tag(node, "SKU") || tag(node, "ItemID"),
        price: Number(tag(node, "CurrentPrice") || tag(node, "BuyItNowPrice") || 0),
        currency: node.match(/currencyID="([^"]+)"/)?.[1] || "USD",
        quantity: Number(tag(node, "Quantity") || 0),
        quantitySold: Number(tag(node, "QuantitySold") || 0),
        watchers: Number(tag(node, "WatchCount") || 0),
        imageUrl: tag(node, "GalleryURL") || tag(node, "PictureURL") || undefined,
        listedAt: listedAt || undefined,
        url: tag(node, "ViewItemURL") || `https://www.ebay.com/itm/${tag(node, "ItemID")}`,
        ageDays,
      });
    }
    if (rows.length < perPage || items.length >= total) break;
    page += 1;
  }
  return items;
}

// GetMyeBaySelling with EntriesPerPage=1 — cheap way to fetch just the total.
export async function fetchLiveListingsSummary(accessToken: string): Promise<{ total: number; totalWatchers: number; totalSold: number }> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
    <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
      <ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel>
      <ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination></ActiveList>
      <DetailLevel>ReturnAll</DetailLevel>
    </GetMyeBaySellingRequest>`;
  const text = await tradingCall(accessToken, "GetMyeBaySelling", body);
  const total = Number(tag(text, "TotalNumberOfEntries") || 0);
  let totalWatchers = 0, totalSold = 0;
  for (const m of text.matchAll(/<Item>([\s\S]*?)<\/Item>/g)) {
    totalWatchers += Number(tag(m[1], "WatchCount") || 0);
    totalSold += Number(tag(m[1], "QuantitySold") || 0);
  }
  return { total, totalWatchers, totalSold };
}

// Fulfillment API — recent orders for the seller.
export async function fetchEbayOrders(accessToken: string, limit = 50) {
  const res = await fetch(`${EBAY_API_BASE}/sell/fulfillment/v1/order?limit=${limit}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Orders: ${json.errors?.[0]?.message || res.statusText}`);
  return (json.orders || []).map((o: any) => ({
    orderId: o.orderId,
    creationDate: o.creationDate,
    status: o.orderFulfillmentStatus,
    paymentStatus: o.orderPaymentStatus,
    buyer: o.buyer?.username || "",
    total: Number(o.pricingSummary?.total?.value || 0),
    currency: o.pricingSummary?.total?.currency || "USD",
    itemsCount: (o.lineItems || []).length,
    firstItemTitle: o.lineItems?.[0]?.title || "",
    firstItemImage: o.lineItems?.[0]?.image?.imageUrl || null,
  }));
}

// Finances API — recent monetary transactions (sales, fees, payouts).
// NOTE: the Finances API lives on apiz.ebay.com, not api.ebay.com. Calling it
// on the normal host returns a bare 404 ("Not Found").
export async function fetchEbayTransactions(accessToken: string, limit = 50) {
  const res = await fetch(`${EBAY_FINANCES_BASE}/sell/finances/v1/transaction?limit=${limit}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US", Accept: "application/json" },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Finances: ${financeHint(res.status, json)}`);
  const txns = (json.transactions || []).map((t: any) => ({
    id: t.transactionId,
    date: t.transactionDate,
    type: t.transactionType,
    status: t.transactionStatus,
    amount: Number(t.amount?.value || 0),
    currency: t.amount?.currency || "USD",
    memo: t.transactionMemo || t.orderId || "",
    orderId: t.orderId || null,
  }));
  const totals = txns.reduce((acc: any, t: any) => {
    const key = String(t.type || "OTHER").toUpperCase();
    acc[key] = (acc[key] || 0) + (key === "SALE" ? t.amount : -t.amount);
    return acc;
  }, {} as Record<string, number>);
  return { transactions: txns, totals };
}

// Analytics API — 30-day traffic report.
export async function fetchEbayTrafficReport(accessToken: string) {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const dr = `${fmt(start)}..${fmt(end)}`;
  // date_range and marketplace_ids belong inside `filter`, not as top-level
  // query params; the marketplace filter is required or eBay rejects the call.
  const filter = `marketplace_ids:{EBAY_US},date_range:[${dr}]`;
  const url = `${EBAY_API_BASE}/sell/analytics/v1/traffic_report`
    + `?dimension=DAY&metric=LISTING_IMPRESSION_TOTAL,LISTING_VIEWS_TOTAL,CLICK_THROUGH_RATE,SALES_CONVERSION_RATE`
    + `&filter=${encodeURIComponent(filter)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US", Accept: "application/json" } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Analytics: ${scopeHint(res.status, json)}`);

  const records = (json.records || []).map((r: any) => {
    const row: Record<string, any> = { day: r.dimensionValues?.[0]?.value || "" };
    for (let i = 0; i < (r.metricValues || []).length; i++) {
      const m = r.metricValues[i];
      row[String(m.metricKey || i)] = Number(m.value || 0);
    }
    return row;
  });
  const totals = records.reduce((acc: any, r: any) => {
    acc.impressions += Number(r.LISTING_IMPRESSION_TOTAL || 0);
    acc.views += Number(r.LISTING_VIEWS_TOTAL || 0);
    return acc;
  }, { impressions: 0, views: 0 });
  return { records, totals };
}

// Marketing API — Promoted Listings campaigns.
export async function fetchEbayCampaigns(accessToken: string) {
  const res = await fetch(`${EBAY_API_BASE}/sell/marketing/v1/ad_campaign?limit=25`, {
    headers: { Authorization: `Bearer ${accessToken}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Marketing: ${json.errors?.[0]?.message || res.statusText}`);
  return (json.campaigns || []).map((c: any) => ({
    id: c.campaignId,
    name: c.campaignName,
    status: c.campaignStatus,
    strategy: c.fundingStrategy?.fundingModel,
    startDate: c.startDate,
    endDate: c.endDate,
  }));
}
