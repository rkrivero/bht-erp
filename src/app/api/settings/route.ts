import { NextRequest, NextResponse } from "next/server";
import {
  withAuthenticatedClient,
  withAuthenticatedTransaction,
} from "@/lib/auth";
import { resolveHttpError } from "@/lib/http-errors";
import { runIdempotentMutation } from "@/lib/idempotency";
import {
  getSystemSettings,
  updateSystemSettings,
} from "@/lib/services/settings";
import { parseBody, readRawJsonBody } from "@/lib/validation/parse";
import { patchSystemSettingsSchema } from "@/lib/validation/settings.schema";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  try {
    const data = await withAuthenticatedClient(
      req,
      ["PARTNER_ADMIN", "PARTNER_MANAGER"],
      async (client) => {
        return await getSystemSettings(client);
      }
    );
    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error cargando configuración del sistema",
      "GET /api/settings"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const rawBody = await readRawJsonBody(req);
    const result = await withAuthenticatedTransaction(
      req,
      ["PARTNER_ADMIN", "PARTNER_MANAGER"],
      async (client, actor) => {
        const body = parseBody(patchSystemSettingsSchema, rawBody);
        const updates: Array<{ key: string; value: unknown }> = [];
        if (body.settingKey && body.settingValue !== undefined) {
          updates.push({ key: body.settingKey, value: body.settingValue });
        }
        if (body.settings) {
          for (const [k, v] of Object.entries(body.settings)) {
            updates.push({ key: k, value: v });
          }
        }
        if (body.updates) {
          for (const u of body.updates) {
            updates.push({ key: u.key, value: u.value });
          }
        }
        return runIdempotentMutation(
          client,
          req,
          actor,
          "settings:update",
          body,
          () => updateSystemSettings(client, actor, updates)
        );
      }
    );
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const { status, ...payload } = resolveHttpError(
      err,
      "Error actualizando configuración del sistema",
      "PATCH /api/settings"
    );
    return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
  }
}

export const POST = PATCH;
