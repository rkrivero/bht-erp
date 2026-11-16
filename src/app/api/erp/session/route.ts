import { NextResponse } from "next/server";
import { getAuthenticatedERPActor } from "@/lib/auth";
import { AuthenticationError } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getAuthenticatedERPActor();
    if (!session) throw new AuthenticationError();
    return NextResponse.json({ session }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Tu correo aún no está habilitado en el ERP." },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
}
