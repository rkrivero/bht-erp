import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";

export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = verifySessionToken(token);

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
