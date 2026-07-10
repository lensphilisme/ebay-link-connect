import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, Eye, RefreshCcw, Rocket, Flame, Sparkles, ImageOff, DollarSign } from "lucide-react";

export const Route = createFileRoute("/_authenticated/growth")({ component: GrowthPage });

function GrowthPage() {
  const { data: listings = [] } = useQuery({
    queryKey: ["ebay-listings-growth"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ebay_listings").select("*").eq("status", "active");
      if (error) throw error;
      return data || [];
    },
  });

  const total = listings.length;
  const totalSales = listings.reduce((s: number, l: any) => s + (l.sales || 0), 0);
  const totalViews = listings.reduce((s: number, l: any) => s + (l.views || 0), 0);
  const conversion = totalViews > 0 ? (totalSales / totalViews) * 100 : 0;

  const bestSellers = [...listings].sort((a: any, b: any) => (b.sales || 0) - (a.sales || 0)).filter((l: any) => (l.sales || 0) > 0).slice(0, 5);
  const mostWatched = [...listings].sort((a: any, b: any) => (b.views || 0) - (a.views || 0)).filter((l: any) => (l.views || 0) > 0 && (l.sales || 0) === 0).slice(0, 5);
  const stalePricey = [...listings].filter((l: any) => (l.sales || 0) === 0 && Number(l.price) > 25).sort((a: any, b: any) => Number(b.price) - Number(a.price)).slice(0, 5);

  const suggestions = [
    { icon: Flame, title: "Restock winners", desc: `${bestSellers.length} listings converting — duplicate them into new colors or bundle sets.`, cta: "Open drafts", to: "/drafts" as const },
    { icon: Sparkles, title: "Rewrite invisible listings", desc: `Optimizer can rewrite titles for high-watch/no-sale items automatically.`, cta: "Open optimizer", to: "/optimizer" as const },
    { icon: DollarSign, title: "Test a 10% price drop", desc: `${stalePricey.length} $25+ listings with 0 sales — a small drop often unlocks first sale.`, cta: "Open listings", to: "/listings" as const },
    { icon: RefreshCcw, title: "Cross-post to Facebook Marketplace", desc: `Export your CJ picks with one click from the products page.`, cta: "Find products", to: "/products" as const },
  ];

  return (
    <AppShell title="Growth" subtitle="What to do next to increase sales">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Rocket} label="Active listings" value={total} />
        <StatCard icon={TrendingUp} label="Total sales" value={totalSales} />
        <StatCard icon={Eye} label="Total views" value={totalViews} />
        <StatCard icon={Sparkles} label="Conversion" value={`${conversion.toFixed(2)}%`} />
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        {suggestions.map((s) => (
          <Card key={s.title} className="p-4 flex gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <s.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-sm">{s.title}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
              <Button asChild variant="link" size="sm" className="p-0 h-auto mt-1"><Link to={s.to}>{s.cta} →</Link></Button>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <ListingList title="Top sellers" empty="No sales yet. Give listings 2–4 weeks and use the Optimizer." rows={bestSellers} metric={(l: any) => `${l.sales} sold`} tint="text-primary" />
        <ListingList title="High interest, no sale yet" empty="Nothing hot yet. Sync more from eBay." rows={mostWatched} metric={(l: any) => `${l.views} views`} tint="text-orange-500" />
      </div>

      <Card className="mt-6 p-4">
        <div className="text-sm font-medium mb-2">Weekly funnel</div>
        <div className="text-xs text-muted-foreground mb-2 tabular-nums">{totalSales} sales / {totalViews} views</div>
        <Progress value={Math.min(100, conversion * 10)} />
        <p className="mt-2 text-[11px] text-muted-foreground">Goal: 1–3% conversion is healthy for dropshipping. Below 0.5% usually means the title or main image needs work.</p>
      </Card>
    </AppShell>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </Card>
  );
}

function ListingList({ title, empty, rows, metric, tint }: { title: string; empty: string; rows: any[]; metric: (l: any) => string; tint: string }) {
  return (
    <Card className="p-4">
      <h3 className="font-semibold text-sm mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((l) => (
            <li key={l.id} className="flex items-center gap-3">
              <div className="h-10 w-10 rounded bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                {l.image_url ? <img src={l.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <ImageOff className="h-4 w-4 text-muted-foreground/50" />}
              </div>
              <div className="min-w-0 flex-1">
                <a href={l.ebay_item_id ? `https://www.ebay.com/itm/${l.ebay_item_id}` : undefined} target="_blank" rel="noreferrer" className="text-xs font-medium line-clamp-1 hover:underline">{l.title}</a>
                <div className="text-[11px] text-muted-foreground">${Number(l.price).toFixed(2)}</div>
              </div>
              <Badge variant="secondary" className={`text-[10px] ${tint}`}>{metric(l)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
