import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCjCategories, searchCjProducts, bulkSendCjToDrafts } from "@/lib/cj.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2, ChevronLeft, ChevronRight, FileEdit, FileSpreadsheet, Check, ChevronsUpDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { exportProductsToFbXlsx } from "@/lib/fb-marketplace";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/products/")({
  component: ProductsPage,
});

// CJ Dropshipping search API caps pageSize at 200; larger values 400 out.
const PAGE_SIZES = [20, 50, 100, 200] as const;

function pagerRange(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}

type Query = {
  keyword: string;
  pageNum: number;
  pageSize: number;
  categoryIds?: string[];
  countryCode?: string;
  minPrice?: number;
  maxPrice?: number;
};

function ProductsPage() {
  const initial = (() => {
    if (typeof window === "undefined") return null;
    try { return JSON.parse(sessionStorage.getItem("cj-products-search") || "null"); } catch { return null; }
  })();
  const [keyword, setKeyword] = useState<string>(initial?.keyword ?? "");
  const [query, setQuery] = useState<Query>(initial?.query ?? { keyword: "", pageNum: 1, pageSize: 20 });
  const [categoryIds, setCategoryIds] = useState<string[]>(Array.isArray(initial?.categoryIds) ? initial.categoryIds : []);
  const [countryCode, setCountryCode] = useState<string>(initial?.countryCode ?? "all");
  const [minPrice, setMinPrice] = useState<string>(initial?.minPrice ?? "");
  const [maxPrice, setMaxPrice] = useState<string>(initial?.maxPrice ?? "");
  const [catOpen, setCatOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const queryClient = useQueryClient();

  const searchFn = useServerFn(searchCjProducts);
  const categoriesFn = useServerFn(getCjCategories);
  const { data: categories } = useQuery({
    queryKey: ["cj-categories"],
    queryFn: () => categoriesFn(),
    staleTime: 24 * 60 * 60_000,
  });
  const flatCategories = useMemo(() => (categories ?? []).flatMap((first: any) =>
    (first.categoryFirstList ?? []).flatMap((second: any) =>
      (second.categorySecondList ?? []).map((third: any) => ({
        id: third.categoryId,
        name: `${first.categoryFirstName} / ${second.categorySecondName} / ${third.categoryName}`,
      })),
    ),
  ), [categories]);
  const selectedCategories = useMemo(
    () => categoryIds.map((id) => flatCategories.find((c) => c.id === id) ?? { id, name: id }),
    [categoryIds, flatCategories],
  );

  const { data, isFetching, error } = useQuery({
    queryKey: ["cj-search", query],
    queryFn: () => searchFn({ data: query }),
    enabled: query.keyword.length > 0 || (query.categoryIds?.length ?? 0) > 0,
    staleTime: 60_000,
  });

  const items = data?.list ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try { sessionStorage.setItem("cj-products-search", JSON.stringify({ keyword, query, categoryIds, countryCode, minPrice, maxPrice })); } catch { /* ignore */ }
  }, [keyword, query, categoryIds, countryCode, minPrice, maxPrice]);

  const pids = items.map((p) => p.pid);
  const { data: statusMap = {} } = useQuery({
    queryKey: ["cj-listed-map", pids.join(",")],
    enabled: pids.length > 0,
    queryFn: async () => {
      const map: Record<string, "listed" | "draft"> = {};
      const { data: drafts } = await supabase.from("listing_drafts").select("cj_product_id").in("cj_product_id", pids);
      for (const r of drafts || []) if (r.cj_product_id) map[r.cj_product_id] = "draft";
      return map;
    },
  });

  const canSearch = keyword.trim().length > 0 || categoryIds.length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSearch) {
      toast.error("Please enter a keyword or select at least one category.");
      return;
    }
    const min = Number(minPrice);
    const max = Number(maxPrice);
    setQuery((q) => ({
      ...q,
      keyword,
      categoryIds: categoryIds.length ? categoryIds : undefined,
      countryCode: countryCode === "all" ? undefined : countryCode,
      minPrice: minPrice && !Number.isNaN(min) ? min : undefined,
      maxPrice: maxPrice && !Number.isNaN(max) ? max : undefined,
      pageNum: 1,
    }));
    setSelected({});
  }

  const bulkDraftFn = useServerFn(bulkSendCjToDrafts);
  const bulkDraft = useMutation({
    mutationFn: async () => {
      const chosen = items.filter((p) => selected[p.pid]);
      if (chosen.length === 0) throw new Error("Nothing selected");
      return bulkDraftFn({ data: { pids: chosen.map((p) => p.pid), endCountry: "US", stockCountry: countryCode === "all" ? null : countryCode } });
    },
    onSuccess: (res: any) => {
      const failed = (res.results || []).filter((r: any) => !r.ok).length;
      const draftIds = (res.results || []).filter((r: any) => r.ok && r.draftId).map((r: any) => r.draftId);
      toast.success(`Sent ${res.ok}/${res.total} to drafts${failed ? ` · ${failed} failed` : ""}. Stay here to keep browsing.`);
      setSelected({});
      if (typeof window !== "undefined" && draftIds.length) {
        try { sessionStorage.setItem("drafts-auto-fill", JSON.stringify({ ids: draftIds, at: Date.now() })); } catch { /* ignore */ }
      }
      // Refresh the "In draft / Listed" badges so users see status update in place.
      queryClient.invalidateQueries({ queryKey: ["cj-listed-map"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="CJ Products" subtitle="Search inventory and send winners to your draft queue">
      <form onSubmit={submit} className="grid grid-cols-2 md:flex md:flex-wrap gap-2 mb-3">
        <div className="relative col-span-2 md:flex-1 md:min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Search CJ Dropshipping (e.g. wireless earbuds, kitchen gadget…)"
            className="pl-9"
          />
        </div>
        <Input type="number" inputMode="decimal" min="0" step="0.01" placeholder="Min $" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} className="md:w-24" />
        <Input type="number" inputMode="decimal" min="0" step="0.01" placeholder="Max $" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className="md:w-24" />
        <Select value={countryCode} onValueChange={setCountryCode}>
          <SelectTrigger className="md:w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any warehouse</SelectItem>
            <SelectItem value="CN">CN stock</SelectItem>
            <SelectItem value="US">US stock</SelectItem>
          </SelectContent>
        </Select>
        <Popover open={catOpen} onOpenChange={setCatOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" role="combobox" className="md:w-72 justify-between font-normal">
              <span className="truncate">
                {categoryIds.length === 0
                  ? "Pick CJ categories…"
                  : `${categoryIds.length} categor${categoryIds.length === 1 ? "y" : "ies"} selected`}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(96vw,32rem)] p-0" align="start">
            <Command>
              <div className="flex items-center justify-between gap-2 border-b p-2">
                <span className="text-xs text-muted-foreground">
                  {categoryIds.length} selected
                </span>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setCategoryIds([])} disabled={categoryIds.length === 0}>
                    Clear
                  </Button>
                  <Button type="button" size="sm" onClick={() => setCatOpen(false)}>
                    Done
                  </Button>
                </div>
              </div>
              <CommandInput placeholder="Type to search CJ categories…" />
              <CommandList className="max-h-[60vh]">
                <CommandEmpty>No category matches</CommandEmpty>
                <CommandGroup>
                  {flatCategories.map((c) => {
                    const on = categoryIds.includes(c.id);
                    return (
                      <CommandItem
                        key={c.id}
                        value={c.name}
                        onSelect={() => setCategoryIds((prev) => on ? prev.filter((x) => x !== c.id) : [...prev, c.id])}
                      >
                        <div className={cn("mr-2 flex h-4 w-4 items-center justify-center rounded border border-primary", on ? "bg-primary text-primary-foreground" : "opacity-70")}>
                          {on && <Check className="h-3 w-3" />}
                        </div>
                        <span className="truncate">{c.name}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
              <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t bg-popover p-2 text-xs">
                <span className="text-muted-foreground">{categoryIds.length} selected</span>
                <Button type="button" size="sm" onClick={() => setCatOpen(false)}>Done</Button>
              </div>
            </Command>
          </PopoverContent>
        </Popover>
        <Select
          value={String(query.pageSize)}
          onValueChange={(v) => setQuery((q) => ({ ...q, pageSize: Number(v), pageNum: 1 }))}
        >
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={isFetching || !canSearch}>
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </Button>
        {(minPrice || maxPrice || categoryIds.length > 0) && (
          <Button type="button" variant="ghost" size="sm" onClick={() => { setMinPrice(""); setMaxPrice(""); setCategoryIds([]); }}>
            <X className="h-4 w-4 mr-1" /> Clear filters
          </Button>
        )}
      </form>

      {selectedCategories.length > 0 && (
        <div className="mb-4 rounded-lg border bg-muted/30 p-2">
          <div className="mb-1 flex items-center justify-between px-1 text-xs text-muted-foreground">
            <span>Selected: {selectedCategories.length} categor{selectedCategories.length === 1 ? "y" : "ies"}</span>
            <button type="button" className="text-primary hover:underline" onClick={() => setCategoryIds([])}>Clear all</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selectedCategories.map((c) => (
              <span key={c.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                <span className="max-w-[16rem] truncate" title={c.name}>{c.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${c.name}`}
                  onClick={() => setCategoryIds((prev) => prev.filter((x) => x !== c.id))}
                  className="rounded-full hover:bg-primary/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      {!canSearch && (
        <p className="mb-3 text-xs text-muted-foreground">Please enter a keyword or select at least one category.</p>
      )}

      {error ? (
        <Card className="p-6 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {(error as Error).message}
        </Card>
      ) : null}

      {selectedIds.length > 0 && (
        <div className="sticky top-16 z-20 mb-4 flex items-center gap-3 bg-card border rounded-lg px-4 py-2 shadow-sm">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected({})}>Clear</Button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const chosen = items.filter((p) => selected[p.pid]);
              if (chosen.length === 0) return;
              const { data: rule } = await supabase.from("automation_rules").select("markup_percent,ebay_fee_buffer_percent").maybeSingle();
              const n = exportProductsToFbXlsx(
                chosen.map((p) => ({
                  pid: p.pid,
                  productSku: p.productSku,
                  productNameEn: p.productNameEn,
                  productImage: p.productImage,
                  categoryName: p.categoryName,
                  sellPrice: p.sellPrice,
                  description: (p as any).description ?? null,
                })),
                { markupPercent: Number(rule?.markup_percent ?? 50), ebayFeeBufferPercent: Number(rule?.ebay_fee_buffer_percent ?? 17) },
                `facebook-marketplace-${new Date().toISOString().slice(0,10)}.xlsx`,
              );
              toast.success(`Exported ${n} product${n === 1 ? "" : "s"} to Facebook Marketplace XLSX${n > 50 ? " (FB caps a single upload at 50 — split the file before uploading)" : ""}`);
            }}
          >
            <FileSpreadsheet className="h-4 w-4 mr-1" />
            Export to FB Marketplace
          </Button>
          <Button size="sm" onClick={() => bulkDraft.mutate()} disabled={bulkDraft.isPending}>
            <FileEdit className="h-4 w-4 mr-1" />
            {bulkDraft.isPending ? "Adding…" : "Send to Drafts"}
          </Button>
        </div>
      )}

      {isFetching && items.length === 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: query.pageSize > 12 ? 12 : query.pageSize }).map((_, i) => (
            <Card key={i} className="aspect-[3/4] animate-pulse bg-muted/40" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          {query.keyword || (query.categoryIds?.length ?? 0) > 0 ? "No products matched your search." : "Enter a search term or choose at least one CJ category to browse inventory."}
        </Card>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 text-sm">
            <Checkbox
              id="select-all-page"
              checked={items.length > 0 && items.every((p) => selected[p.pid])}
              onCheckedChange={(v) => {
                setSelected((s) => {
                  const next = { ...s };
                  if (v) for (const p of items) next[p.pid] = true;
                  else for (const p of items) delete next[p.pid];
                  return next;
                });
              }}
            />
            <label htmlFor="select-all-page" className="cursor-pointer select-none text-muted-foreground">
              Select all {items.length} on this page
            </label>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">

            {items.map((p) => {
              const checked = !!selected[p.pid];
              const status = (statusMap as any)[p.pid];
              const toggle = () => setSelected((s) => ({ ...s, [p.pid]: !s[p.pid] }));
              return (
                <Card key={p.pid} className={`group relative overflow-hidden border-0 bg-[var(--gradient-hero)] shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)] ${checked ? "ring-2 ring-primary" : ""}`}>
                  <div className="absolute top-2 left-2 z-10">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => setSelected((s) => ({ ...s, [p.pid]: !!v }))}
                      className="bg-background/90 border-border"
                    />
                  </div>
                  {status && (
                    <div className="absolute top-2 right-2 z-10">
                      <Badge variant={status === "listed" ? "default" : "secondary"} className="text-[10px]">
                        {status === "listed" ? "Listed on eBay" : "In draft"}
                      </Badge>
                    </div>
                  )}
                  <button type="button" onClick={toggle} aria-label={checked ? "Deselect" : "Select"} className="block w-full text-left">
                    <div className="aspect-square bg-muted overflow-hidden">
                      {p.productImage && (
                        <img
                          src={p.productImage}
                          alt={p.productNameEn}
                          loading="lazy"
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                        />
                      )}
                    </div>
                  </button>
                   <div className="p-3 bg-card/90 backdrop-blur">
                     <Link to="/products/$pid" params={{ pid: p.pid }} className="block min-h-[2.25rem] text-sm font-extrabold font-display leading-snug hover:underline">
                       {truncateName(p.productNameEn, 20)}
                    </Link>
                     <div className="mt-2 flex items-start justify-between gap-2">
                      {p.categoryName && (
                         <Badge variant="secondary" className="min-w-0 flex-1 justify-start truncate text-[10px]">{truncateName(p.categoryName, 18)}</Badge>
                      )}
                       <span className="shrink-0 rounded-md bg-primary px-2 py-1 text-xs font-extrabold text-primary-foreground shadow-sm">${Number(p.sellPrice).toFixed(2)}</span>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="mt-6 flex items-center justify-between flex-wrap gap-3">
            <div className="text-xs text-muted-foreground">
              Page {query.pageNum} of {totalPages} · {total.toLocaleString()} results
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <Button
                variant="outline" size="sm"
                disabled={query.pageNum <= 1 || isFetching}
                onClick={() => setQuery((q) => ({ ...q, pageNum: q.pageNum - 1 }))}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              {pagerRange(query.pageNum, totalPages).map((p, i) =>
                p === "…" ? (
                  <span key={`gap-${i}`} className="px-1.5 text-xs text-muted-foreground">…</span>
                ) : (
                  <Button
                    key={p}
                    variant={p === query.pageNum ? "default" : "outline"}
                    size="sm"
                    className="min-w-[2.25rem] px-2"
                    disabled={isFetching}
                    onClick={() => setQuery((q) => ({ ...q, pageNum: p }))}
                  >
                    {p}
                  </Button>
                ),
              )}
              <Button
                variant="outline" size="sm"
                disabled={query.pageNum >= totalPages || isFetching}
                onClick={() => setQuery((q) => ({ ...q, pageNum: q.pageNum + 1 }))}
                aria-label="Next page"
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

function truncateName(value: unknown, max = 20) {
  const text = String(value ?? "").trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}
