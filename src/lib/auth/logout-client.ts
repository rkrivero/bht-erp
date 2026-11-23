"use client";

/** Load the Neon Auth client only when the user explicitly closes the session. */
export async function signOutFromERP(): Promise<void> {
  try {
    const { getBrowserQueryClient } = await import("@/components/providers/QueryProvider");
    getBrowserQueryClient().clear();
  } catch {
    // ignore query cleanup errors
  }

  if (typeof caches !== "undefined") {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys.map(async (key) => {
          const cache = await caches.open(key);
          await Promise.all([
            cache.delete("/vendedor"),
            cache.delete("/almacen"),
            cache.delete(`${window.location.origin}/vendedor`),
            cache.delete(`${window.location.origin}/almacen`),
          ]);
        })
      );
    } catch {
      // ignore Cache API cleanup errors
    }
  }

  try {
    const { clearSyncedOutbox } = await import("@/lib/offline/outbox");
    await clearSyncedOutbox();
  } catch {
    // ignore IndexedDB cleanup errors
  }

  const { authClient } = await import("./client");
  await authClient.signOut();
}
