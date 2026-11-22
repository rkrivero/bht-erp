"use client";

import React, { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  BHT_SYNC_CHANNEL_NAME,
  type SyncScope,
} from "@/lib/realtime/useLiveSync";

export const BHT_QUERY_INVALIDATE_EVENT = "bht:sync-scopes";

let browserQueryClient: QueryClient | null = null;

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

export function getBrowserQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    return createQueryClient();
  }
  if (!browserQueryClient) {
    browserQueryClient = createQueryClient();
  }
  return browserQueryClient;
}

export function invalidateQueryScopes(
  client: QueryClient,
  scopes?: SyncScope[]
): void {
  if (!scopes || scopes.length === 0) {
    void client.invalidateQueries();
    return;
  }
  const scopeSet = new Set<string>(scopes);
  void client.invalidateQueries({
    predicate: (query) => {
      const keyParts = query.queryKey.map((part) => String(part).toLowerCase());
      if (keyParts.some((part) => scopeSet.has(part))) {
        return true;
      }
      if (
        keyParts.includes("reports") &&
        (scopeSet.has("orders") ||
          scopeSet.has("treasury") ||
          scopeSet.has("collections") ||
          scopeSet.has("purchases") ||
          scopeSet.has("partners"))
      ) {
        return true;
      }
      return false;
    },
  });
}

export function dispatchSyncScopeInvalidation(scopes: SyncScope[]): void {
  if (typeof window === "undefined") return;
  if (browserQueryClient) {
    invalidateQueryScopes(browserQueryClient, scopes);
  }
  window.dispatchEvent(
    new CustomEvent<{ scopes: SyncScope[] }>(BHT_QUERY_INVALIDATE_EVENT, {
      detail: { scopes },
    })
  );
}

export default function QueryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [queryClient] = useState<QueryClient>(() => getBrowserQueryClient());

  useEffect(() => {
    const onScopeEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ scopes?: SyncScope[] }>).detail;
      invalidateQueryScopes(queryClient, detail?.scopes);
    };
    window.addEventListener(BHT_QUERY_INVALIDATE_EVENT, onScopeEvent);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        channel = new BroadcastChannel(BHT_SYNC_CHANNEL_NAME);
        channel.onmessage = (event) => {
          const payload = event.data as { scopes?: SyncScope[] } | undefined;
          invalidateQueryScopes(queryClient, payload?.scopes);
        };
      } catch {
        channel = null;
      }
    }

    return () => {
      window.removeEventListener(BHT_QUERY_INVALIDATE_EVENT, onScopeEvent);
      try {
        channel?.close();
      } catch {
        // ignore
      }
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
