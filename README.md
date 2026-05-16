# @bunnykit/storage

Laravel Storage-inspired file storage abstraction for Bun. Supports local disk and S3-compatible backends (Cloudflare R2, AWS S3, MinIO, etc.) with an optional media-tracking layer backed by `@bunnykit/orm`.

## Requirements

- [Bun](https://bun.sh) 1.2+

## Installation

```sh
bun add @bunnykit/storage
```

For media tracking (file upload + DB record):

```sh
bun add @bunnykit/storage @bunnykit/orm
```

## Quick Start

```ts
import { storage } from '@bunnykit/storage';

// write
await storage().put('reports/q1.pdf', pdfBuffer);

// read
const bytes = await storage().get('reports/q1.pdf');
const text  = await storage().getText('reports/q1.txt');

// public URL
storage().url('reports/q1.pdf'); // → http://localhost/storage/reports/q1.pdf

// fetch from URL and store (auto-generated filename → avatars/<uuid>.jpg)
const path = await storage().putFromUrl('https://example.com/avatar.jpg', 'avatars');

// with explicit filename → avatars/user-123.jpg
const path = await storage('r2').putFromUrl('https://example.com/avatar.jpg', 'avatars', 'user-123');

// read without throwing on missing
const content = await storage().getTextNullable('optional.txt'); // null if missing

// file metadata (no download)
const bytes = await storage().size('reports/q1.pdf');
const date  = await storage().lastModified('reports/q1.pdf');
const mime  = await storage().mimeType('reports/q1.pdf');

// recursive listing
const all = await storage().allFiles('uploads'); // includes subdirectories

// stream a large file (no memory pressure)
const stream = storage('r2').getStream('videos/big.mp4');
return new Response(stream);

// write from a stream (e.g. pipe request body directly to storage)
await storage().putStream('uploads/file.bin', request.body!);

// copy within same disk
await storage().copy('reports/q1.pdf', 'archive/q1.pdf');

// move within same disk
await storage().move('tmp/upload.pdf', 'reports/q1.pdf');

// copy across disks (streamed)
await Storage.copyAcross('local', 'reports/q1.pdf', 'r2', 'archive/q1.pdf');

// move across disks (streamed, removes source)
await Storage.moveAcross('local', 'tmp/upload.pdf', 'r2', 'reports/q1.pdf');

// delete
await storage().delete('reports/q1.pdf');
```

## Configuration

Create `storage.config.ts` at your project root (or adapt the bundled one):

```ts
// storage.config.ts
import type { DiskConfig } from '@bunnykit/storage';

const disks = {
  local: {
    driver: 'local' as const,
    root: process.env.STORAGE_LOCAL_ROOT ?? 'data/storage',
    publicUrl: process.env.STORAGE_LOCAL_URL ?? '/storage'
  },
  r2: {
    driver: 's3' as const,
    bucket: process.env.R2_BUCKET ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    endpoint: process.env.R2_ACCOUNT_ID
      ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : undefined,
    publicUrl: process.env.R2_PUBLIC_URL
  }
  s3: {
    driver: 's3' as const,
    bucket: process.env.AWS_BUCKET ?? '',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    region: process.env.AWS_REGION ?? 'us-east-1',
    publicUrl: process.env.AWS_PUBLIC_URL  // e.g. https://my-bucket.s3.amazonaws.com
  }
} satisfies Record<string, DiskConfig>;

export default {
  default: (process.env.STORAGE_DISK ?? 'local') as keyof typeof disks,
  disks
};
```

Set `STORAGE_DISK=r2` to switch the default disk at runtime.

## Disks

### Local

| Option | Default | Description |
|--------|---------|-------------|
| `root` | `data/storage` | Absolute or relative path on disk |
| `publicUrl` | `/storage` | Base URL prepended by `url()` |

### S3 / R2 / MinIO

Uses Bun's built-in `Bun.S3Client` — no extra dependency.

| Option | Description |
|--------|-------------|
| `bucket` | Bucket name |
| `accessKeyId` | Access key |
| `secretAccessKey` | Secret key |
| `endpoint` | Custom endpoint (required for R2/MinIO) |
| `publicUrl` | Base URL for `url()` |
| `defaultUrlExpiry` | Default TTL in seconds for `temporaryUrl()`. Default: `3600` |

## API

### `storage(disk?)`

Returns the driver for the named disk (default if omitted).

```ts
import { storage } from '@bunnykit/storage';

storage();        // default disk
storage('r2');    // named disk
```

### `Storage` — singleton manager

```ts
import Storage from '@bunnykit/storage';

Storage.disk();           // default driver
Storage.disk('r2');       // named driver
Storage.defaultDisk;      // name of the default disk
```

### Driver methods

All methods are available on the object returned by `storage()` or `Storage.disk()`.

| Method | Returns | Description |
|--------|---------|-------------|
| `put(path, contents)` | `Promise<void>` | Write string / Uint8Array / ArrayBuffer / Blob |
| `putFile(dir, file, name?)` | `Promise<string>` | Store a `File`; returns stored path |
| `putFromUrl(url, dir, name?)` | `Promise<string>` | Fetch a URL and store the result; returns stored path |
| `putStream(path, stream)` | `Promise<void>` | Write to a file from a `ReadableStream` |
| `get(path)` | `Promise<Uint8Array>` | Read as bytes |
| `getNullable(path)` | `Promise<Uint8Array \| null>` | Read as bytes, returns null if file missing |
| `getText(path)` | `Promise<string>` | Read as UTF-8 string |
| `getTextNullable(path)` | `Promise<string \| null>` | Read as string, returns null if file missing |
| `getStream(path)` | `ReadableStream<Uint8Array>` | Read as a stream without loading into memory |
| `copy(source, destination)` | `Promise<void>` | Copy a file to a new path on the same disk |
| `move(source, destination)` | `Promise<void>` | Move a file to a new path on the same disk |
| `exists(path)` | `Promise<boolean>` | Check existence |
| `delete(path)` | `Promise<void>` | Remove file |
| `url(path)` | `string` | Public URL |
| `temporaryUrl(path, seconds?)` | `Promise<string>` | Presigned URL (S3) or public URL (local). Falls back to `defaultUrlExpiry` config, then 3600 |
| `size(path)` | `Promise<number>` | File size in bytes without downloading |
| `lastModified(path)` | `Promise<Date>` | Last modified timestamp |
| `mimeType(path)` | `Promise<string>` | MIME type of the file |
| `files(directory)` | `Promise<string[]>` | List files in a directory (non-recursive) |
| `allFiles(directory)` | `Promise<string[]>` | List all files recursively |
| `makeDirectory(path)` | `Promise<void>` | Create directory (no-op on S3) |

### StorageManager facade shortcuts

All driver methods are also available directly on `Storage`, operating on the default disk:

```ts
await Storage.put('file.txt', 'hello');
await Storage.getText('file.txt');
Storage.url('file.txt');
```

### Cross-disk operations

`copyAcross` and `moveAcross` work between different disks. Content is streamed — no full load into memory.

```ts
import Storage from '@bunnykit/storage';

// copy from local to R2
await Storage.copyAcross('local', 'reports/q1.pdf', 'r2', 'archive/q1.pdf');

// move from local to R2, removes source after
await Storage.moveAcross('local', 'tmp/upload.pdf', 'r2', 'reports/q1.pdf');
```

## S3-Compatible Providers

Any provider that speaks the S3 API works. Set `endpoint` for non-AWS providers.

### Cloudflare R2

```ts
r2: {
  driver: 's3',
  bucket: process.env.R2_BUCKET ?? '',
  accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  publicUrl: process.env.R2_PUBLIC_URL  // e.g. https://pub-xxx.r2.dev
}
```

### MinIO (self-hosted)

```ts
minio: {
  driver: 's3',
  bucket: process.env.MINIO_BUCKET ?? '',
  accessKeyId: process.env.MINIO_ACCESS_KEY ?? '',
  secretAccessKey: process.env.MINIO_SECRET_KEY ?? '',
  endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
  region: 'us-east-1'
}
```

### Backblaze B2

```ts
b2: {
  driver: 's3',
  bucket: process.env.B2_BUCKET ?? '',
  accessKeyId: process.env.B2_KEY_ID ?? '',
  secretAccessKey: process.env.B2_APP_KEY ?? '',
  endpoint: `https://s3.${process.env.B2_REGION}.backblazeb2.com`,
  publicUrl: process.env.B2_PUBLIC_URL
}
```

### DigitalOcean Spaces

```ts
spaces: {
  driver: 's3',
  bucket: process.env.DO_SPACES_BUCKET ?? '',
  accessKeyId: process.env.DO_SPACES_KEY ?? '',
  secretAccessKey: process.env.DO_SPACES_SECRET ?? '',
  endpoint: `https://${process.env.DO_SPACES_REGION}.digitaloceanspaces.com`,
  publicUrl: `https://${process.env.DO_SPACES_BUCKET}.${process.env.DO_SPACES_REGION}.digitaloceanspaces.com`
}
```

### Wasabi

```ts
wasabi: {
  driver: 's3',
  bucket: process.env.WASABI_BUCKET ?? '',
  accessKeyId: process.env.WASABI_ACCESS_KEY ?? '',
  secretAccessKey: process.env.WASABI_SECRET_KEY ?? '',
  endpoint: `https://s3.${process.env.WASABI_REGION}.wasabisys.com`,
  region: process.env.WASABI_REGION ?? 'us-east-1'
}
```

### Vultr Object Storage

```ts
vultr: {
  driver: 's3',
  bucket: process.env.VULTR_BUCKET ?? '',
  accessKeyId: process.env.VULTR_ACCESS_KEY ?? '',
  secretAccessKey: process.env.VULTR_SECRET_KEY ?? '',
  endpoint: `https://${process.env.VULTR_REGION}.vultrobjects.com`
}
```

### Linode / Akamai Object Storage

```ts
linode: {
  driver: 's3',
  bucket: process.env.LINODE_BUCKET ?? '',
  accessKeyId: process.env.LINODE_ACCESS_KEY ?? '',
  secretAccessKey: process.env.LINODE_SECRET_KEY ?? '',
  endpoint: `https://${process.env.LINODE_REGION}.linodeobjects.com`
}
```

### Tigris

```ts
tigris: {
  driver: 's3',
  bucket: process.env.TIGRIS_BUCKET ?? '',
  accessKeyId: process.env.TIGRIS_ACCESS_KEY ?? '',
  secretAccessKey: process.env.TIGRIS_SECRET_KEY ?? '',
  endpoint: 'https://fly.storage.tigris.dev',
  region: 'auto'
}
```

### Supabase Storage

```ts
supabase: {
  driver: 's3',
  bucket: process.env.SUPABASE_BUCKET ?? '',
  accessKeyId: process.env.SUPABASE_ACCESS_KEY ?? '',
  secretAccessKey: process.env.SUPABASE_SECRET_KEY ?? '',
  endpoint: `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co/storage/v1/s3`,
  region: process.env.SUPABASE_REGION ?? 'us-east-1'
}
```

## Extensibility

### Custom driver

```ts
import Storage from '@bunnykit/storage';
import type { StorageDriver } from '@bunnykit/storage';

class GCSDriver implements StorageDriver {
  constructor(private config: { bucket: string }) {}
  // implement all StorageDriver methods ...
}

Storage.extend('gcs', (config) => new GCSDriver(config));
```

### Add a disk

```ts
const TypedStorage = Storage.addDisk('backups', {
  driver: 'gcs',
  bucket: 'my-backups'
});

TypedStorage.disk('backups'); // autocompleted
```

`addDisk()` returns a typed manager that includes the new disk name for IDE autocomplete.

## Media Tracking

Requires `@bunnykit/orm`. Tracks uploaded files in an `attachments` database table — similar to Laravel's `spatie/laravel-medialibrary`.

### Migration

Run the bundled migration to create the `attachments` table:

```ts
import { Migration, Schema } from '@bunnykit/orm';

export default class CreateAttachments extends Migration {
  async up() {
    await Schema.create('attachments', (table) => {
      table.uuid('id').primary();
      table.string('attachable_type').notNullable();
      table.string('attachable_id').notNullable();
      table.string('collection').notNullable().default('default');
      table.string('provider').notNullable().default('local');
      table.string('bucket_name').notNullable().default('');
      table.string('key').notNullable();
      table.string('original_name').notNullable();
      table.string('mime_type').notNullable();
      table.bigInteger('size_bytes').notNullable();
      table.string('checksum', 64).nullable();
      table.string('visibility').notNullable().default('private');
      table.text('metadata').nullable();
      table.integer('sort_order').notNullable().default(0);
      table.string('uploaded_by_id').nullable();
      table.timestamp('deleted_at').nullable();
      table.timestamps();
    });
  }

  async down() {
    await Schema.dropIfExists('attachments');
  }
}
```

### Usage

```ts
import { media } from '@bunnykit/storage';

// model must have { id: string, constructor: Function }
// constructor must have a static `table` property or class name is used as type

const user = await User.find('abc-123');

// upload and record
const item = await (await media(user)).put(avatarFile, {
  collection: 'avatar',
  visibility: 'public'
});

// single-file collection — auto-deletes previous before uploading
const item = await (await media(user)).put(avatarFile, {
  collection: 'avatar',
  single: true
});

// get URL
item.url();
await item.temporaryUrl(3600);

// retrieve
const avatar = await (await media(user)).first('avatar');
const docs   = await (await media(user)).all('documents');

// delete (soft-delete DB record + remove from storage)
await (await media(user)).delete(item.id);

// hard delete
await (await media(user)).purge(item.id);

// replace (delete all in collection, then upload)
await (await media(user)).replace(newFile, { collection: 'avatar' });
```

### PutOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `collection` | `string` | `'default'` | Logical grouping (e.g. `'avatar'`, `'documents'`) |
| `disk` | `string` | default disk | Which disk to store on |
| `name` | `string` | UUID | Override stored filename (without extension) |
| `visibility` | `'public' \| 'private'` | `'private'` | File visibility |
| `single` | `boolean` | `false` | Delete all existing in collection before upload |
| `metadata` | `object` | — | Arbitrary JSON stored alongside the record |
| `uploadedById` | `string \| null` | `null` | ID of the uploading user |

### Record without uploading

If the file is already on disk:

```ts
await (await media(user)).record('path/to/file.pdf', {
  originalName: 'report.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 204800,
  collection: 'reports'
});
```

### Upload from URL

```ts
await (await media(user)).putFromUrl('https://example.com/avatar.jpg', {
  collection: 'avatar',
  single: true
});
```

## License

MIT

---

**Keywords:** `bun` `storage` `s3` `r2` `local` `file-upload` `media` `attachments` `cloudflare-r2` `aws-s3` `minio` `backblaze` `laravel` `filesystem` `object-storage` `typescript`
