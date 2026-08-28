"use client";

import { useMemo } from "react";
import { useSelectedClient } from "@/hooks/use-selected-client";
import {
  DEFAULT_CURRENCY,
  currencySymbol,
  formatCurrency,
  formatCurrencyCompact,
} from "@/lib/format";

/** ISO 4217 code of the selected client's ad accounts; DEFAULT_CURRENCY for
 * demo clients (no ad account) and while the client list is still loading. */
export function useClientCurrency(): string {
  return useSelectedClient()?.currency ?? DEFAULT_CURRENCY;
}

/** Currency formatters pre-bound to the selected client's currency. Drop-in for
 * the `@/lib/format` imports inside client-scoped components. */
export function useCurrencyFormat() {
  const currency = useClientCurrency();
  return useMemo(
    () => ({
      currency,
      symbol: currencySymbol(currency),
      formatCurrency: (n: number) => formatCurrency(n, currency),
      formatCurrencyCompact: (n: number) => formatCurrencyCompact(n, currency),
    }),
    [currency]
  );
}
