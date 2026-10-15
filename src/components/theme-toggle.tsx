import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

/** Conmutador claro/oscuro (next-themes, `attribute="class"`). */
export function ThemeToggle() {
  const { t } = useTranslation("chrome");
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground"
      title={isDark ? t("theme.light") : t("theme.dark")}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted && !isDark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
    </Button>
  );
}
