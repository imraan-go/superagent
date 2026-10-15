import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getEnv, requireKeys } from '@superagent/config';

export interface PutResult {
  sha256: string;
  sizeBytes: number;
}

export interface ArtifactStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<PutResult>;
  get(key: string): Promise<{ stream: Readable; contentType?: string; contentLength?: number }>;
  delete(key: string): Promise<void>;
  health(): Promise<{ ok: boolean; detail: string }>;
}

export function artifactKey(ownerId: string, taskId: string | null, artifactId: string, safeName: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(ownerId)) throw new Error('invalid owner id for object key');
  return `owners/${ownerId}/${taskId ? `tasks/${taskId}` : 'misc'}/${artifactId}/${safeName}`;
}

/**
 * S3-compatible store: MinIO locally, AWS S3 later. The bucket is private; downloads are streamed
 * through the authenticated API after an ownership check rather than via public/presigned URLs.
 */
export class S3ArtifactStore implements ArtifactStore {
  private readonly client: S3Client;
  private bucketReady?: Promise<void>;

  constructor(
    private readonly bucket: string,
    opts: { endpoint?: string; region: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean },
  ) {
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: opts.forcePathStyle,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch {
        // New MinIO/S3 buckets are private; no anonymous policy is ever attached.
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      }
    })();
    return this.bucketReady;
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<PutResult> {
    await this.ensureBucket();
    const sha256 = createHash('sha256').update(body).digest('hex');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
        Metadata: { sha256 },
      }),
    );
    return { sha256, sizeBytes: body.byteLength };
  }

  async get(key: string) {
    await this.ensureBucket();
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!out.Body) throw new Error('object has no body');
    return { stream: out.Body as Readable, contentType: out.ContentType, contentLength: out.ContentLength };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async health() {
    try {
      await this.ensureBucket();
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true, detail: `bucket ${this.bucket} reachable` };
    } catch (err) {
      this.bucketReady = undefined;
      return { ok: false, detail: err instanceof Error ? err.name : 'unreachable' };
    }
  }
}

let store: ArtifactStore | undefined;

export function getArtifactStore(): ArtifactStore {
  if (store) return store;
  const env = getEnv();
  const k = requireKeys('storage', ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'], 'Run `pnpm setup:env` and `pnpm infra:up`.');
  store = new S3ArtifactStore(env.S3_BUCKET, {
    endpoint: k.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: k.S3_ACCESS_KEY_ID,
    secretAccessKey: k.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
  return store;
}

/** For tests only. */
export function setArtifactStore(s: ArtifactStore | undefined): void {
  store = s;
}

export class MemoryArtifactStore implements ArtifactStore {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  async put(key: string, body: Uint8Array, contentType: string) {
    this.objects.set(key, { body, contentType });
    return { sha256: createHash('sha256').update(body).digest('hex'), sizeBytes: body.byteLength };
  }
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) throw new Error('NoSuchKey');
    return { stream: Readable.from(Buffer.from(o.body)), contentType: o.contentType, contentLength: o.body.byteLength };
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async health() {
    return { ok: true, detail: 'memory (test only)' };
  }
}
