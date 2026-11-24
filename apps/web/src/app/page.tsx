import { redirect } from "next/navigation";
import { getAuthenticatedERPActor } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getAuthenticatedERPActor();

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
