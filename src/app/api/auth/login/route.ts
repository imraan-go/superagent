import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { getSession } from "@/server/auth/session";
import { verifyPassword } from "@/server/auth/password";
import { checkLoginRate, clientIp, recordLoginAttempt } from "@/server/auth/rate-limit";
import { AppError, toAppError } from "@/server/lib/errors";

export const runtime = "nodejs";
/** Never cached, never prerendered — it reads cookies and writes a session. */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(512),
});

export async function POST(request: Request) {
  const ip = clientIp(request.headers);

  try {
    const rate = await checkLoginRate(ip);
    if (rate.blocked) {
      throw new AppError(
        "rate_limited",
        `Too many attempts. Try again in ${Math.ceil(rate.retryAfterS / 60)} min.`,
        { detail: { retryAfterS: rate.retryAfterS } },
      );
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("bad_request", "Email and password are required.");
    }

    const email = parsed.data.email.trim().toLowerCase();
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    // Same message and roughly the same work either way, so the response does
    // not reveal whether the address exists.
    const ok = user ? await verifyPassword(user.passHash, parsed.data.password) : false;

    await recordLoginAttempt(ip, ok);

    if (!ok || !user) {
      throw new AppError("unauthorized", "Incorrect email or password.");
    }

    const session = await getSession();
    session.userId = user.id;
    session.email = user.email;
    session.loggedInAt = Math.floor(Date.now() / 1000);
    await session.save();

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    const appErr = toAppError(err);
    return NextResponse.json(appErr.toJSON(), {
      status: appErr.status,
      headers: appErr.code === "rate_limited" && appErr.detail?.retryAfterS
        ? { "Retry-After": String(appErr.detail.retryAfterS) }
        : undefined,
    });
  }
}
