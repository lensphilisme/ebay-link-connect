import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const stripHtml = (v: unknown) =>
  String(v ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

function imagesOf(d: any): string[] {
  const raw = Array.isArray(d.images) ? d.images : [];
  return raw
    .map((i: any) => (typeof i === "string" ? i : i?.url || i?.src))
    .filter((u: any) => typeof u === "string" && /^https?:\/\//.test(u));
}

export const Route = createFileRoute("/api/public/meta-catalog/$userId/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const parsed = z
          .object({ userId: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{32}$/) })
          .safeParse({ userId: params.userId, token: params.token.replace(/\.xml$/, "") });
        if (!parsed.success) return new Response("Not found", { status: 404 });

        const { verifyFeedToken } = await import("@/lib/meta-feed.server");
        if (!(await verifyFeedToken(parsed.data.userId, parsed.data.token))) {
          return new Response("Not found", { status: 404 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { checkListingPolicy } = await import("@/lib/policy-guard");
        const { guessFbCategory } = await import("@/lib/fb-marketplace");

        const userId = parsed.data.userId;
        const [{ data: drafts }, { data: settings }] = await Promise.all([
          supabaseAdmin
            .from("listing_drafts")
            .select("id, sku, title, description, price, quantity, images, brand, cj_product_id, condition")
            .eq("user_id", userId)
            .in("status", ["pending", "approved", "pushed"])
            .limit(5000),
          (supabaseAdmin.from("app_settings") as any).select("app_url").eq("user_id", userId).maybeSingle(),
        ]);
        const base = String(settings?.app_url || "https://ebay-link-connect.lovable.app").replace(/\/$/, "");

        const items: string[] = [];
        for (const d of drafts || []) {
          const price = Number(d.price);
          const imgs = imagesOf(d);
          if (!(price > 0) || !imgs.length || !d.title) continue;
          const policy = checkListingPolicy({ title: d.title, description: d.description, brand: d.brand });
          if (!policy.ok) continue;
          const desc = stripHtml(policy.description || d.title).slice(0, 5000) || policy.title;
          items.push(
            [
              "<item>",
              `<g:id>${esc(d.sku || d.id)}</g:id>`,
              `<g:item_group_id>${esc(d.cj_product_id)}</g:item_group_id>`,
              `<g:title>${esc(policy.title.slice(0, 150))}</g:title>`,
              `<g:description>${esc(desc)}</g:description>`,
              `<g:availability>${Number(d.quantity) > 0 ? "in stock" : "out of stock"}</g:availability>`,
              `<g:inventory>${Math.max(0, Number(d.quantity) || 0)}</g:inventory>`,
              `<g:condition>new</g:condition>`,
              `<g:price>${price.toFixed(2)} USD</g:price>`,
              `<g:link>${esc(`${base}/?item=${encodeURIComponent(d.sku || d.id)}`)}</g:link>`,
              `<g:image_link>${esc(imgs[0])}</g:image_link>`,
              ...imgs.slice(1, 10).map((u) => `<g:additional_image_link>${esc(u)}</g:additional_image_link>`),
              `<g:brand>${esc(d.brand && d.brand.toLowerCase() !== "unbranded" ? d.brand : "Generic")}</g:brand>`,
              `<g:google_product_category>${esc(guessFbCategory(null, policy.title).replace(/\/\//g, " > "))}</g:google_product_category>`,
              "</item>",
            ].join(""),
          );
        }

        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>Product catalog</title><link>${esc(base)}</link><description>Live catalog feed</description>\n${items.join("\n")}\n</channel></rss>`;
        return new Response(xml, {
          headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=900" },
        });
      },
    },
  },
});
