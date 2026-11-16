import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE_NAME,
  verifyActiveSessionUser,
  verifySessionToken,
} from "@/lib/auth";
import { withClient } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const parsed = verifySessionToken(token);
  const user = parsed
    ? await withClient((client) => verifyActiveSessionUser(client, parsed))
    : null;

  if (!user) {
    redirect("/login");
  }
  if (user.role === "WAREHOUSE_DELIVERY") {
    redirect("/almacen");
  }
  if (user.role === "EXTERNAL_SELLER") {
    redirect("/vendedor");
  }
  redirect("/socios");
}
