import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { bulkSendCjToDrafts, getCjProduct, getCjFreight } from "@/lib/cj.functions";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { ArrowLeft, Loader2, Truck, FileEdit } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { classifyAxis } from "@/lib/variant-classifier";
import { calculateRulePrice } from "@/lib/pricing";
import { getCjVariantPrice, getCjVariants } from "@/lib/cj-product";

export const Route = createFileRoute("/_authenticated/products/$pid")({
  component: ProductDetailPage,
});

const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
];

function cleanImageList(...inputs: unknown[]) {
  const urls: string[] = [];
  const visit = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try { visit(JSON.parse(trimmed)); return; } catch { /* use as raw below */ }
    }
    try {
      const u = new URL(trimmed.replace(/^['"]|['"]$/g, ""));
      if (u.protocol === "https:" || u.protocol === "http:") urls.push(u.toString());
    } catch { /* ignore */ }
  };
  inputs.forEach(visit);
  return Array.from(new Set(urls));
}

function splitVariantParts(v: any): string[] {
  const label = String(v?.variantKey || v?.variantNameEn || v?.variantSku || v?.vid || "").trim();
  return label.split(/[-,/|>]+/).map((p) => p.trim()).filter(Boolean);
}

function deriveAxes(variants: any[]): string[] {
  if (!variants.length) return [];
  const slotCount = Math.max(1, ...variants.map((v) => splitVariantParts(v).length || 1));
  const axes: string[] = [];
  for (let i = 0; i < slotCount; i++) {
    const values = variants.map((v) => splitVariantParts(v)[i]).filter(Boolean) as string[];
    const cat = classifyAxis(values);
    axes.push(cat === "Unknown" ? (slotCount === 1 ? "Option" : `Variant Option ${i + 1}`) : cat);
  }
  // Dedupe repeats
  const seen = new Map<string, number>();
  return axes.map((a) => {
    const n = (seen.get(a) || 0) + 1;
    seen.set(a, n);
    return n === 1 ? a : `${a} ${n}`;
  });
}

function variantOptionMap(variant: any, axes: string[]) {
  const parts = splitVariantParts(variant);
  const label = parts.join(" / ") || String(variant?.variantSku || variant?.vid || "Option");
  const values = parts.length === axes.length ? parts : axes.length === 1 ? [label] : axes.map((_, i) => parts[i] || label);
  return Object.fromEntries(axes.map((axis, i) => [axis, values[i] || label]));
}

function ProductDetailPage() {
  const { pid } = Route.useParams();
  const productFn = useServerFn(getCjProduct);
  const freightFn = useServerFn(getCjFreight);
  const bulkDraftFn = useServerFn(bulkSendCjToDrafts);
  const navigate = useNavigate();

  const { data: p, isLoading, error } = useQuery({
    queryKey: ["cj-product", pid],
    queryFn: () => productFn({ data: { pid } }),
    staleTime: 5 * 60_000,
  });

  const variants = useMemo(() => {
    return getCjVariants(p);
  }, [p]);

  const images = useMemo(() => {
    if (!p) return [] as string[];
    const all = new Set<string>();
    if (p.bigImage) all.add(p.bigImage);
    if (p.productImage) all.add(p.productImage);
    (Array.isArray(p.productImageSet) ? p.productImageSet : []).forEach((u) => u && all.add(u));
    (Array.isArray(p.productImages) ? p.productImages : []).forEach((u) => u && all.add(u));
    variants.forEach((v) => v.variantImage && all.add(v.variantImage));
    return cleanImageList(Array.from(all));
  }, [p, variants]);

  const [country, setCountry] = useState("US");
  const [variantId, setVariantId] = useState<string>("");
  const { data: pricingRule } = useQuery({
    queryKey: ["automation-rules"],
    queryFn: async () => {
      const { data, error: ruleError } = await supabase.from("automation_rules").select("*").maybeSingle();
      if (ruleError) throw ruleError;
      return data;
    },
    staleTime: 60_000,
  });

  const firstPricedVariant = variants.find((variant) => getCjVariantPrice(variant, p?.sellPrice) != null) || variants[0];
  const activeVid = variantId || firstPricedVariant?.vid || "";
  const activeVariant = variants.find((v) => v.vid === activeVid);
  const itemCost = getCjVariantPrice(activeVariant, p?.sellPrice) ?? 0;

  const freight = useMutation({
    mutationFn: async () => {
      const vid = activeVid;
      if (!vid) throw new Error("No variant available for freight quote");
      return freightFn({ data: { endCountryCode: country, products: [{ vid, quantity: 1 }] } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const [selectedCarrier, setSelectedCarrier] = useState<string>("");
  const validFreight = (freight.data || []).filter((option) => Number.isFinite(Number(option.logisticPrice)) && Number(option.logisticPrice) >= 0);
  const preferredFreight = validFreight.filter((option) => {
    const days = String(option.logisticAging || "").match(/\d+/g)?.map(Number) || [];
    return days.some((day) => day >= 4 && day <= 7);
  });
  const cheapestCarrier = [...(preferredFreight.length ? preferredFreight : validFreight)].sort((a, b) => Number(a.logisticPrice) - Number(b.logisticPrice))[0];
  const carrier = validFreight.find((o) => o.logisticName === selectedCarrier) ?? cheapestCarrier;
  const shipping = Number(carrier?.logisticPrice ?? 0);

  const pricing = calculateRulePrice(itemCost, shipping, pricingRule || {});
  const axes = useMemo(() => deriveAxes(variants), [variants]);
  const selectedOptions = activeVariant ? variantOptionMap(activeVariant, axes) : {};

  useEffect(() => {
    if (!activeVid) return;
    setSelectedCarrier("");
    freight.mutate();
    // Freight must refresh whenever the selected variant or destination changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVid, country]);

  const sendToDraft = useMutation({
    mutationFn: async () => {
      if (!p) throw new Error("Loading…");
      // Reuse the freight already quoted on this page so we never re-quote (and
      // never fail) at draft time; free-shipping items simply send $0.
      const result = await bulkDraftFn({
        data: {
          pids: [p.pid],
          endCountry: country,
          preferredVariantId: activeVid || null,
          shippingOverride: carrier ? shipping : null,
          carrierOverride: carrier?.logisticName ?? null,
        },
      });
      const saved = result.results[0];
      if (!saved?.ok) throw new Error(saved?.error || "Draft could not be created");
    },
    onSuccess: () => {
      toast.success("Draft saved");
      navigate({ to: "/drafts" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title={p?.productNameEn ?? "Product"} subtitle={p?.categoryName}>
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm"><Link to="/products"><ArrowLeft className="h-4 w-4 mr-1" />Back to search</Link></Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <Card className="p-6 border-destructive/40 bg-destructive/5 text-sm text-destructive">{(error as Error).message}</Card>
      ) : !p ? null : (
        <div className="grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-6 max-w-full overflow-hidden">
          {/* Image carousel */}
          <div className="min-w-0 max-w-full overflow-hidden">
            <Carousel className="w-full max-w-full overflow-hidden">
              <CarouselContent>
                {images.length === 0 ? (
                  <CarouselItem><div className="aspect-square bg-muted rounded-lg" /></CarouselItem>
                ) : images.map((src, i) => (
                  <CarouselItem key={`${src}-${i}`}>
                    <div className="aspect-square bg-muted rounded-lg overflow-hidden">
                      <img src={src} alt={`${p.productNameEn} ${i + 1}`} className="w-full h-full object-contain" />
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
              {images.length > 1 && (<><CarouselPrevious className="left-2" /><CarouselNext className="right-2" /></>)}
            </Carousel>
            <div className="mt-3 grid grid-cols-6 gap-2 max-w-full">
              {images.slice(0, 12).map((src, i) => (
                <div key={`${src}-thumb-${i}`} className="aspect-square bg-muted rounded overflow-hidden">
                  <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          </div>

          {/* Details + pricing */}
          <div className="space-y-5 min-w-0 max-w-full overflow-hidden">
            <div>
              <h2 className="text-xl font-semibold leading-snug break-words">{p.productNameEn}</h2>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary">SKU: {p.productSku}</Badge>
                {p.categoryName && <Badge variant="secondary">{p.categoryName}</Badge>}
                {p.productWeight && <Badge variant="outline">{p.productWeight}g</Badge>}
                <Badge variant="outline">{variants.length || 1} variant{variants.length === 1 ? "" : "s"}</Badge>
              </div>
            </div>

            {variants.length > 0 && (
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Variant</Label>
                <Select value={activeVid} onValueChange={setVariantId}>
                  <SelectTrigger className="mt-1 max-w-full"><SelectValue placeholder="Select variant" /></SelectTrigger>
                  <SelectContent>
                    {variants.map((v) => (
                      <SelectItem key={v.vid} value={v.vid}>
                        {v.variantNameEn || v.variantKey || v.variantSku} · ${(getCjVariantPrice(v, p.sellPrice) ?? 0).toFixed(2)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(selectedOptions).map(([axis, value]) => (
                    <Badge key={axis} variant="secondary" className="max-w-full whitespace-normal break-words">{axis}: {String(value)}</Badge>
                  ))}
                </div>
              </div>
            )}

            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium"><Truck className="h-4 w-4" /> CJ Freight</div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
                <div>
                  <Label className="text-xs text-muted-foreground">Ship to</Label>
                  <Select value={country} onValueChange={setCountry}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={() => freight.mutate()} disabled={freight.isPending || !activeVid}>
                  {freight.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Quote"}
                </Button>
              </div>
              {freight.error && <p className="text-xs text-destructive">{(freight.error as Error).message}</p>}
              {freight.data && freight.data.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Carrier</Label>
                  <Select value={selectedCarrier || freight.data[0].logisticName} onValueChange={setSelectedCarrier}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {freight.data.map((o) => (
                        <SelectItem key={o.logisticName} value={o.logisticName}>
                          {o.logisticName} · {o.logisticAging}d · ${Number(o.logisticPrice).toFixed(2)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </Card>

            <Card className="p-4 space-y-3">
              <div className="text-sm font-medium">Pricing</div>
              <div>
                <Label className="text-xs text-muted-foreground">Settings markup: {Number(pricingRule?.markup_percent ?? 50)}%</Label>
                <Input type="range" min={0} max={300} step={5} value={Number(pricingRule?.markup_percent ?? 50)} disabled />
              </div>
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Item cost</dt><dd className="text-right">${itemCost.toFixed(2)}</dd>
                <dt className="text-muted-foreground">+ Shipping ({carrier?.logisticName ?? "—"})</dt><dd className="text-right">${shipping.toFixed(2)}</dd>
                <dt className="font-medium">Landed cost</dt><dd className="text-right font-medium">${pricing.landedCost.toFixed(2)}</dd>
                <dt className="text-muted-foreground">Minimum/markup profit</dt><dd className="text-right">${pricing.targetProfit.toFixed(2)}</dd>
                <dt className="text-muted-foreground">eBay fee buffer</dt><dd className="text-right">${pricing.ebayFee.toFixed(2)}</dd>
                <dt className="text-muted-foreground">Payment fee buffer</dt><dd className="text-right">${pricing.paymentFee.toFixed(2)}</dd>
                <dt className="font-semibold">eBay sell price</dt><dd className="text-right font-semibold text-primary">${pricing.sellPrice.toFixed(2)}</dd>
                <dt className="font-semibold">Projected profit</dt><dd className={`text-right font-semibold ${pricing.projectedProfit >= 0 ? "text-success" : "text-destructive"}`}>${pricing.projectedProfit.toFixed(2)}</dd>
              </dl>
              <Button className="w-full" onClick={() => sendToDraft.mutate()} disabled={sendToDraft.isPending}>
                <FileEdit className="h-4 w-4 mr-1" /> {sendToDraft.isPending ? "Quoting logistics & saving…" : "Send to Drafts"}
              </Button>
            </Card>

            {p.description && (
              <Card className="p-4">
                <div className="text-sm font-medium mb-2">Description</div>
                <div className="prose prose-sm max-w-none text-sm overflow-hidden break-words [&_*]:max-w-full [&_img]:h-auto [&_table]:w-full" dangerouslySetInnerHTML={{ __html: p.description }} />
              </Card>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
