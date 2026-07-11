import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

// Floating action button that scrolls the page to the bottom, then flips to
// scroll to the top the next time it's clicked. Hidden when the page isn't
// scrollable. Placed above the mobile bottom nav.
export function ScrollToggleFab() {
  const [visible, setVisible] = useState(false);
  const [direction, setDirection] = useState<"down" | "up">("down");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight > 80;
      setVisible(scrollable);
      const nearBottom = window.scrollY + window.innerHeight >= doc.scrollHeight - 40;
      setDirection(nearBottom ? "up" : "down");
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      mo.disconnect();
    };
  }, []);

  if (!visible) return null;

  const handleClick = () => {
    const doc = document.documentElement;
    if (direction === "down") window.scrollTo({ top: doc.scrollHeight, behavior: "smooth" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const Icon = direction === "down" ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={direction === "down" ? "Scroll to bottom" : "Scroll to top"}
      className={cn(
        "fixed right-4 bottom-24 lg:bottom-6 z-40 h-11 w-11 rounded-full",
        "bg-primary text-primary-foreground shadow-[var(--shadow-elevated)]",
        "flex items-center justify-center transition hover:scale-105 active:scale-95",
        "ring-2 ring-primary/30",
      )}
    >
      <Icon className={cn("h-5 w-5 transition-transform", direction === "up" && "animate-bounce")} />
    </button>
  );
}
