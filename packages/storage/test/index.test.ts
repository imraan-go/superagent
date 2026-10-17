import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { EnvSchema, SetupRequiredError, loadLocalEnv, resetEnvCache } from '@superagent/config';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryArtifactStore, S3ArtifactStore, artifactKey, getArtifactStore, setArtifactStore } from '../src';

const OPTS = { endpoint: 'http://localhost:9000', region: 'us-east-1', accessKeyId: 'test', secretAccessKey: 'test', forcePathStyle: true };

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

/** Stubs S3Client.send so no request ever leaves the process. */
function stubS3(handler: (cmd: unknown) => unknown) {
  return vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (cmd: unknown) => handler(cmd)) as never);
}

beforeAll(() => {
  // Marks the config loader as done so nothing reads the real repo .env.
  loadLocalEnv(join(tmpdir(), 'superagent-storage-test-missing.env'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('artifactKey', () => {
  it('scopes keys by owner and task', () => {
    expect(artifactKey('owner_1', 'task-9', 'art-1', 'report.pdf')).toBe('owners/owner_1/tasks/task-9/art-1/report.pdf');
    expect(artifactKey('owner_1', null, 'art-1', 'report.pdf')).toBe('owners/owner_1/misc/art-1/report.pdf');
  });

  it.each(['', '../x', 'a/b', 'a b', 'a.b'])('rejects owner id %j', (owner) => {
    expect(() => artifactKey(owner, null, 'a', 'b')).toThrow('invalid owner id for object key');
  });
});

describe('S3ArtifactStore', () => {
  it('creates the bucket when HeadBucket fails, only once, and puts with a SHA-256 checksum', async () => {
    let bucketExists = false;
    const send = stubS3((cmd) => {
      if (cmd instanceof HeadBucketCommand && !bucketExists) throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
      if (cmd instanceof CreateBucketCommand) bucketExists = true;
      return {};
    });
    const store = new S3ArtifactStore('bucket-a', OPTS);
    const body = new TextEncoder().encode('hello');
    const sha256 = createHash('sha256').update(body).digest('hex');

    await expect(store.put('k1', body, 'text/plain')).resolves.toEqual({ sha256, sizeBytes: 5 });
    await store.put('k2', body, 'text/plain');

    const cmds = send.mock.calls.map(([c]) => c);
    expect(cmds.filter((c) => c instanceof HeadBucketCommand)).toHaveLength(1);
    expect(cmds.filter((c) => c instanceof CreateBucketCommand)).toHaveLength(1);
    const put = cmds.find((c) => c instanceof PutObjectCommand) as PutObjectCommand;
    expect(put.input).toMatchObject({
      Bucket: 'bucket-a',
      Key: 'k1',
      ContentType: 'text/plain',
      ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
      Metadata: { sha256 },
    });
  });

  it('streams objects back with their metadata', async () => {
    stubS3((cmd) => {
      if (cmd instanceof GetObjectCommand) {
        expect(cmd.input).toEqual({ Bucket: 'bucket-a', Key: 'k1' });
        return { Body: Readable.from(Buffer.from('payload')), ContentType: 'text/plain', ContentLength: 7 };
      }
      return {};
    });
    const out = await new S3ArtifactStore('bucket-a', OPTS).get('k1');
    expect(out.contentType).toBe('text/plain');
    expect(out.contentLength).toBe(7);
    expect(await readAll(out.stream)).toBe('payload');
  });

  it('fails when the object has no body', async () => {
    stubS3(() => ({}));
    await expect(new S3ArtifactStore('bucket-a', OPTS).get('k1')).rejects.toThrow('object has no body');
  });

  it('deletes by bucket and key', async () => {
    const send = stubS3(() => ({}));
    await new S3ArtifactStore('bucket-a', OPTS).delete('k1');
    const del = send.mock.calls[0]![0] as DeleteObjectCommand;
    expect(del).toBeInstanceOf(DeleteObjectCommand);
    expect(del.input).toEqual({ Bucket: 'bucket-a', Key: 'k1' });
  });

  it('reports health and retries bucket setup after a failure', async () => {
    let up = false;
    const send = stubS3(() => {
      if (!up) throw Object.assign(new Error('down'), { name: 'ECONNREFUSED' });
      return {};
    });
    const store = new S3ArtifactStore('bucket-a', OPTS);
    await expect(store.health()).resolves.toEqual({ ok: false, detail: 'ECONNREFUSED' });
    up = true;
    const before = send.mock.calls.length;
    await expect(store.health()).resolves.toEqual({ ok: true, detail: 'bucket bucket-a reachable' });
    expect(send.mock.calls.length).toBeGreaterThan(before + 1);
  });
});

describe('MemoryArtifactStore', () => {
  it('round-trips objects and deletes them', async () => {
    const store = new MemoryArtifactStore();
    const body = new TextEncoder().encode('abc');
    const res = await store.put('k', body, 'text/plain');
    expect(res).toEqual({ sha256: createHash('sha256').update(body).digest('hex'), sizeBytes: 3 });
    const got = await store.get('k');
    expect(got.contentType).toBe('text/plain');
    expect(got.contentLength).toBe(3);
    expect(await readAll(got.stream)).toBe('abc');
    await store.delete('k');
    await expect(store.get('k')).rejects.toThrow('NoSuchKey');
  });
});

describe('getArtifactStore', () => {
  beforeEach(() => {
    for (const key of Object.keys(EnvSchema.shape)) vi.stubEnv(key, undefined);
    resetEnvCache();
    setArtifactStore(undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
    setArtifactStore(undefined);
  });

  it('requires S3 credentials', () => {
    expect(() => getArtifactStore()).toThrow(SetupRequiredError);
  });

  it('builds and caches an S3 store from the environment', () => {
    vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'test');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'test');
    const store = getArtifactStore();
    expect(store).toBeInstanceOf(S3ArtifactStore);
    expect(getArtifactStore()).toBe(store);
  });

  it('returns an injected store', () => {
    const mem = new MemoryArtifactStore();
    setArtifactStore(mem);
    expect(getArtifactStore()).toBe(mem);
  });
});
