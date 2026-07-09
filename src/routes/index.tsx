import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DropList — Bulk-list CJ Dropshipping products to eBay" },
      { name: "description", content: "Find winning CJ Dropshipping products, build optimized eBay drafts and bulk-push to your eBay account." },
      { property: "og:title", content: "DropList — Bulk-list CJ Dropshipping products to eBay" },
      { property: "og:description", content: "Find winning CJ Dropshipping products, build optimized eBay drafts and bulk-push to your eBay account." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="relative h-screen w-full overflow-hidden bg-background flex flex-col">
      {/* animated color blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="blob" style={{ background: "var(--brand-blue)", width: 380, height: 380, top: -80, left: -80 }} />
        <div className="blob" style={{ background: "var(--brand-red)", width: 300, height: 300, bottom: -60, right: -40, animationDelay: "2s" }} />
        <div className="blob" style={{ background: "var(--brand-yellow)", width: 260, height: 260, top: "40%", right: "20%", animationDelay: "4s" }} />
        <div className="blob" style={{ background: "var(--brand-green)", width: 220, height: 220, bottom: "10%", left: "10%", animationDelay: "6s" }} />
      </div>

      <header className="shrink-0 px-5 sm:px-8 h-14 flex items-center justify-between">
        <Link to="/"><BrandLogo size="sm" /></Link>
        <Button asChild size="sm" variant="ghost" className="text-xs">
          <Link to="/auth">Sign in</Link>
        </Button>
      </header>

      <main className="flex-1 min-h-0 flex flex-col items-center justify-center text-center px-6 rise">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 backdrop-blur px-3 py-1 text-[11px] font-medium text-muted-foreground mb-5">
          <Sparkles className="h-3.5 w-3.5 text-[var(--brand-blue)]" />
          CJ Dropshipping → eBay, automated
        </div>

        <h1 className="font-display font-black tracking-tight leading-[0.95] text-[clamp(2.5rem,11vw,5.5rem)] max-w-4xl">
          List smarter.
          <span className="block animated-gradient">Sell faster.</span>
        </h1>

        <p className="mt-5 text-sm sm:text-base text-muted-foreground max-w-md">
          Bulk-push winning products from CJ to eBay in one click.
        </p>

        <div className="mt-7 flex flex-wrap gap-3 justify-center">
          <Button asChild size="lg" className="gap-2 shadow-[var(--shadow-elevated)]">
            <Link to="/auth">Start listing <ArrowRight className="h-4 w-4" /></Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="backdrop-blur bg-card/60">
            <Link to="/auth">Sign in</Link>
          </Button>
        </div>
      </main>

      <footer className="shrink-0 px-6 py-3 text-center text-[11px] text-muted-foreground">
        © {new Date().getFullYear()} DropList
      </footer>
    </div>
  );
}
