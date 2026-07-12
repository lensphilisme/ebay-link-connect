import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Type, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getAppSettings, setTypographyFont, DEFAULT_FONT } from "@/lib/app-settings.functions";
import { POPULAR_GOOGLE_FONTS, googleFontsCss2Url } from "@/lib/google-fonts";

export function TypographySettings() {
  const qc = useQueryClient();
  const getFn = useServerFn(getAppSettings);
  const setFn = useServerFn(setTypographyFont);

  const { data } = useQuery({ queryKey: ["app-settings"], queryFn: () => getFn() });
  const current = data?.typography_font || DEFAULT_FONT;

  const [open, setOpen] = useState(false);
  const [customName, setCustomName] = useState("");

  const save = useMutation({
    mutationFn: (font: string) => setFn({ data: { font } }),
    onSuccess: (res) => {
      toast.success(`Font set to ${res.typography_font}`);
      qc.invalidateQueries({ queryKey: ["app-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Preload popular font previews so the combobox items render in their own face.
  useEffect(() => {
    const id = "app-typography-previews";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    const families = POPULAR_GOOGLE_FONTS.slice(0, 24).map((f) => `family=${f.replace(/\s+/g, "+")}:wght@500`).join("&");
    link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    document.head.appendChild(link);
  }, []);

  const options = useMemo(() => {
    const set = new Set(POPULAR_GOOGLE_FONTS);
    if (current) set.add(current);
    return Array.from(set);
  }, [current]);

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader className="flex flex-row items-start gap-4 space-y-0">
        <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Type className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <CardTitle>Typography</CardTitle>
          <CardDescription className="mt-1">
            Pick any Google Font. It applies site-wide instantly and is saved to your account.
          </CardDescription>
        </div>
        <span className="rounded-full bg-primary/10 text-primary text-xs px-2 py-0.5 font-medium">{current}</span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Active font</Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="w-full justify-between">
                <span style={{ fontFamily: `"${current}", sans-serif` }}>{current}</span>
                <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
              <Command>
                <CommandInput placeholder="Search Google Fonts…" />
                <CommandList className="max-h-[50vh]">
                  <CommandEmpty>No matches. Try a custom name below.</CommandEmpty>
                  <CommandGroup>
                    {options.map((f) => (
                      <CommandItem
                        key={f}
                        value={f}
                        onSelect={() => { save.mutate(f); setOpen(false); }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", current === f ? "opacity-100" : "opacity-0")} />
                        <span style={{ fontFamily: `"${f}", sans-serif` }}>{f}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-1.5">
          <Label>Use a custom Google Font</Label>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. Space Grotesk"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={!customName.trim() || save.isPending}
              onClick={() => save.mutate(customName.trim())}
            >
              Apply
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Any family available at{" "}
            <a className="text-primary underline" href="https://fonts.google.com" target="_blank" rel="noreferrer">
              fonts.google.com
            </a>{" "}
            works. Preview URL: <code className="text-[10px]">{googleFontsCss2Url(current)}</code>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
