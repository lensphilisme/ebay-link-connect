import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMetaFeedInfo } from "@/lib/meta-feed.functions";
import { getAppSettings } from "@/lib/app-settings.functions";

export function MetaFeedSettings() {
  const infoFn = useServerFn(getMetaFeedInfo);
  const settingsFn = useServerFn(getAppSettings);
  const { data, isLoading } = useQuery({ queryKey: ["meta-feed-info"], queryFn: () => infoFn() });
  const { data: settings } = useQuery({ queryKey: ["app-settings"], queryFn: () => settingsFn() });

  if (isLoading || !data) return <Loader2 className="h-4 w-4 animate-spin" />;
  const base = String(settings?.app_url || "https://ebay-link-connect.lovable.app").replace(/\/$/, "");
  const url = `${base}${data.path}`;

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        Your drafts are published as a live catalog. Facebook Shop and Instagram Shop read it automatically.
        Items blocked by the policy guard are left out. {data.itemCount} drafts are eligible.
      </p>
      <div className="flex gap-2">
        <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="secondary"
          onClick={() => navigator.clipboard.writeText(url).then(() => toast.success("Feed link copied"))}
        >
          <Copy className="h-4 w-4 mr-1" /> Copy
        </Button>
      </div>
      <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
        <li>Open Meta Commerce Manager → your catalog → Data sources → Add items → Data feed.</li>
        <li>Choose “Scheduled feed” and paste the link above.</li>
        <li>Set it to refresh hourly or daily, currency USD. Done — new drafts appear automatically.</li>
      </ol>
      <p className="text-xs text-muted-foreground">Keep this link private — anyone with it can see your catalog.</p>
    </div>
  );
}
