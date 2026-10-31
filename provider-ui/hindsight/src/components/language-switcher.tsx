"use client";

import { useLocale } from "use-intl";
import { useRouter, usePathname } from "@hs/i18n/navigation";
import { locales, localeNames, type Locale } from "@hs/i18n/config";
import { useTranslations } from "use-intl";
import { Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@hs/components/ui/dropdown-menu";
import { Button } from "@hs/components/ui/button";

/** The current locale and a function that switches the app to another one. */
export function useSwitchLocale() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const switchLocale = (newLocale: Locale) => router.replace(pathname, { locale: newLocale });
  return { locale, switchLocale };
}

export function LanguageSwitcher() {
  const t = useTranslations("common");
  const { locale, switchLocale } = useSwitchLocale();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title={t("changeLanguage")}>
          <Globe className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((l) => (
          <DropdownMenuItem
            key={l}
            onClick={() => switchLocale(l)}
            className={l === locale ? "bg-accent" : ""}
          >
            {localeNames[l]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
