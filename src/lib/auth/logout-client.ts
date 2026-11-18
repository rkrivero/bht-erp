"use client";

/** Load the Neon Auth client only when the user explicitly closes the session. */
export async function signOutFromERP(): Promise<void> {
  const { authClient } = await import("./client");
  await authClient.signOut();
}
