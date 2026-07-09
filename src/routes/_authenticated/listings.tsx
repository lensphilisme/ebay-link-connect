import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { syncEbayListings } from "@/lib/ebay.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DownloadCloud, Loader2, ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { toast } from "sonner";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/listings")({ component: ListingsPage });

const PAGE_SIZES = [25, 50, 100, 200] as const;

function ListingsPage() {
  const syncFn = useServerFn(syncEbayListings);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);

  const { data = [], refetch, isLoading } = useQuery({
    queryKey: ["ebay-listings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ebay_listings").select("*").order("listed_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const rows = useMemo(
    () => Array.from(new Map(data.map((l: any) => [l.ebay_item_id || l.id, l])).values()),
    [data],
  );
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const pageRows = rows.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

  const sync = useMutation({
    mutationFn: () => syncFn({ data: { entriesPerPage: 200 } }),
    onSuccess: (r: any) => {
      toast.success(`Synced ${r.synced || 0} active listing${(r.synced || 0) === 1 ? "" : "s"}${r.pruned ? ` · removed ${r.pruned} stale` : ""}`);
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Active listings" subtitle="Your live eBay listings, synced from your connected account">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
        <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
          <DownloadCloud className="h-4 w-4 mr-1" />
          {sync.isPending ? "Syncing…" : "Sync all from eBay"}
        </Button>
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">{total} listing{total === 1 ? "" : "s"} stored</div>
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-10"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : total === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No synced listings yet. Click <strong>Sync from eBay</strong> to pull your active inventory.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16" />
                  <TableHead>Item</TableHead>
                  <TableHead className="hidden sm:table-cell">SKU</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead className="hidden md:table-cell">Sales</TableHead>
                  <TableHead className="hidden md:table-cell">Watch</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((l: any) => {
                  const img = Array.isArray(l.images) ? l.images[0] : l.image_url || l.thumbnail_url;
                  return (
                    <TableRow key={l.id}>
                      <TableCell>
                        <div className="h-12 w-12 rounded bg-muted overflow-hidden flex items-center justify-center">
                          {img ? (
                            <img
                              src={img}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                            />
                          ) : (
                            <ImageOff className="h-4 w-4 text-muted-foreground/50" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <a
                          className="font-medium hover:underline line-clamp-2"
                          href={l.ebay_item_id ? `https://www.ebay.com/itm/${l.ebay_item_id}` : undefined}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {l.title}
                        </a>
                        <div className="text-xs text-muted-foreground">{l.ebay_item_id}</div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs">{l.sku}</TableCell>
                      <TableCell>${Number(l.price).toFixed(2)}</TableCell>
                      <TableCell className="hidden md:table-cell">{l.sales}</TableCell>
                      <TableCell className="hidden md:table-cell">{l.views}</TableCell>
                      <TableCell>{l.status}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {total > pageSize && (
        <div className="mt-4 flex items-center justify-between flex-wrap gap-3">
          <div className="text-xs text-muted-foreground">
            Page {clampedPage} of {totalPages} · showing {(clampedPage - 1) * pageSize + 1}–{Math.min(clampedPage * pageSize, total)} of {total}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={clampedPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button variant="outline" size="sm" disabled={clampedPage >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
