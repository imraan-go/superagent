import "server-only";
import type { z } from "zod";
import { AppError } from "./errors";

/** Parses a JSON request body against a zod schema, mapping failures to 400. */
export async function parseBody<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError("bad_request", parsed.error.issues[0]?.message ?? "Invalid body.");
  }
  return parsed.data as z.infer<S>;
}

/** Parses URL search params against a zod schema, mapping failures to 400. */
export function parseQuery<S extends z.ZodTypeAny>(url: string, schema: S): z.infer<S> {
  const parsed = schema.safeParse(Object.fromEntries(new URL(url).searchParams));
  if (!parsed.success) throw new AppError("bad_request", parsed.error.issues[0]?.message ?? "Invalid query.");
  return parsed.data as z.infer<S>;
}
