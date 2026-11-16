import { auth } from "@/lib/auth/server";

export default auth.middleware({
  loginUrl: "/login",
  publicRoutes: ["/login", "/signup", "/verify-email", "/forgot-password", "/offline"],
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|manifest.webmanifest).*)",
  ],
};
