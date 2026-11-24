import { createNeonAuth } from "@neon/auth/next/server";

const baseUrl = process.env.NEON_AUTH_BASE_URL?.trim();
const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET?.trim();

if (!baseUrl) {
  throw new Error("NEON_AUTH_BASE_URL es obligatorio para Neon Auth");
}
if (!cookieSecret || cookieSecret.length < 32) {
  throw new Error("NEON_AUTH_COOKIE_SECRET debe tener al menos 32 caracteres");
}

export const auth = createNeonAuth({
  baseUrl,
  cookies: { secret: cookieSecret },
});
