export interface StorageDriver {
	/** Write a file. Accepts string, binary data, or Blob. */
	put(path: string, contents: string | Uint8Array | ArrayBuffer | Blob): Promise<void>;

	/** Store a File object under `directory`. Returns the stored path. */
	putFile(directory: string, file: File, name?: string): Promise<string>;

	/** Read a file as raw bytes. */
	get(path: string): Promise<Uint8Array>;

	/** Read a file as a UTF-8 string. */
	getText(path: string): Promise<string>;

	/** Delete a file. */
	delete(path: string): Promise<void>;

	/** Check whether a file exists. */
	exists(path: string): Promise<boolean>;

	/** Return the public URL for a file. */
	url(path: string): string;

	/** Return a presigned (temporary) URL. Falls back to `url()` for local disk. */
	temporaryUrl(path: string, expiresInSeconds?: number): Promise<string>;

	/** Return a readable stream for a file. Avoids loading the entire file into memory. */
	getStream(path: string): ReadableStream<Uint8Array>;

	/** Write to a file from a readable stream. */
	putStream(path: string, stream: ReadableStream<Uint8Array>): Promise<void>;

	/** List file paths inside a directory. */
	files(directory: string): Promise<string[]>;

	/** Create a directory. No-op on S3-compatible backends. */
	makeDirectory(directory: string): Promise<void>;
}

export interface LocalDiskConfig {
	driver: 'local';
	/** Absolute or relative root directory on the local filesystem. */
	root: string;
	/** Base URL prepended to paths returned by `url()`. */
	publicUrl?: string;
}

export interface S3DiskConfig {
	driver: 's3';
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	/** S3-compatible endpoint URL (e.g. Cloudflare R2, MinIO). */
	endpoint?: string;
	region?: string;
	/** Public base URL for the bucket (e.g. `https://pub-xxx.r2.dev`). */
	publicUrl?: string;
	/** Default expiry in seconds for `temporaryUrl()`. Default: 3600. */
	defaultUrlExpiry?: number;
}

export type DiskConfig = LocalDiskConfig | S3DiskConfig;
