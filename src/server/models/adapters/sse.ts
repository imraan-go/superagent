import "server-only";

/**
 * Minimal SSE frame reader for vendor response bodies.
 *
 * Both Anthropic and the OpenAI-compatible vendors stream `data: <json>` lines,
 * but a chunk boundary can land mid-line — the bug this exists to prevent is
 * parsing half a JSON object and dropping a token.
 */
export async function* readSseData(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<{ event: string | null; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line; keep the trailing partial.
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
        boundary = buffer.indexOf("\n\n");
      }
    }

    const tail = parseFrame(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): { event: string | null; data: string } | null {
  let event: string | null = null;
  const data: string[] = [];

  for (const rawLine of frame.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }

  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}
