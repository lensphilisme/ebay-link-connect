import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Globe } from "lucide-react";
import { getAppSettings, setAppUrl, DEFAULT_APP_URL } from "@/lib/app-settings.functions";

export function AppUrlSettings() {
  const qc = useQueryClient();
  const getFn = useServerFn(getAppSettings);
  const setFn = useServerFn(setAppUrl);
  const { data } = useQuery({ queryKey: ["app-settings"], queryFn: () => getFn() });
  const current = data?.app_url || DEFAULT_APP_URL;
  const [value, setValue] = useState(current);

  useEffect(() => { setValue(current); }, [current]);

  const save = useMutation({
    mutationFn: (url: string) => setFn({ data: { url } }),
    onSuccess: (res) => {
      toast.success("App URL updated");
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      setValue(res.app_url);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Globe className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">
            The live URL of this app. Used to build the eBay OAuth redirect and any
            outbound links. Update once, applies everywhere.
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>App URL</Label>
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://your-app.lovable.app"
          />
          <Button
            onClick={() => save.mutate(value.trim())}
            disabled={!value.trim() || value.trim() === current || save.isPending}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          eBay callback URL: <code className="text-[10px]">{current}/ebay/callback</code>
        </p>
      </div>
    </div>
  );
}
