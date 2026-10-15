import { z } from "zod";

/** LHOS HITL ids are short hex tokens; keep the bridge path strictly safe. */
export const hitlIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
