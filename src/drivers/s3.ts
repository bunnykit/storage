import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StorageDriver, S3DiskConfig } from '../types';

export class S3Driver implements StorageDriver {
	private readonly client: InstanceType<typeof Bun.S3Client>;

	constructor(private readonly config: S3DiskConfig) {
		this.client = new Bun.S3Client({
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
			endpoint: config.endpoint,
			region: config.region ?? 'auto',
			bucket: config.bucket
		});
	}

	async put(path: string, contents: string | Uint8Array | ArrayBuffer | Blob): Promise<void> {
		await this.client.write(path, contents);
	}

	async putFile(directory: string, file: Blob & { name: string }, name?: string): Promise<string> {
		const ext = extname(file.name) || `.${file.type.split('/')[1] ?? 'bin'}`;
		const filename = (name ?? randomUUID()) + ext;
		const path = `${directory.replace(/\/$/, '')}/${filename}`;
		await this.put(path, file);
		return path;
	}

	async get(path: string): Promise<Uint8Array> {
		return this.client.file(path).bytes();
	}

	async getText(path: string): Promise<string> {
		return this.client.file(path).text();
	}

	async copy(source: string, destination: string): Promise<void> {
		const data = await this.client.file(source).bytes();
		await this.client.write(destination, data);
	}

	async move(source: string, destination: string): Promise<void> {
		await this.copy(source, destination);
		await this.client.delete(source);
	}

	async delete(path: string): Promise<void> {
		await this.client.delete(path);
	}

	async exists(path: string): Promise<boolean> {
		return this.client.file(path).exists();
	}

	url(path: string): string {
		if (this.config.publicUrl) {
			return `${this.config.publicUrl.replace(/\/$/, '')}/${path.replace(/^\/+/, '')}`;
		}
		const endpoint = this.config.endpoint?.replace(/\/$/, '') ?? '';
		return `${endpoint}/${this.config.bucket}/${path.replace(/^\/+/, '')}`;
	}

	async temporaryUrl(path: string, expiresInSeconds?: number): Promise<string> {
		const ttl = expiresInSeconds ?? this.config.defaultUrlExpiry ?? 3600;
		return this.client.file(path).presign({ expiresIn: ttl });
	}

	getStream(path: string): ReadableStream<Uint8Array> {
		return this.client.file(path).stream() as ReadableStream<Uint8Array>;
	}

	async putStream(path: string, stream: ReadableStream<Uint8Array>): Promise<void> {
		const writer = this.client.file(path).writer();
		const reader = stream.getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				writer.write(value);
			}
		} finally {
			reader.releaseLock();
		}
		await writer.end();
	}

	async files(directory: string): Promise<string[]> {
		const prefix = directory.replace(/\/$/, '') + '/';
		const results: string[] = [];
		let token: string | undefined;
		do {
			const response = await this.client.list({
				prefix,
				delimiter: '/',
				...(token ? { continuationToken: token } : {})
			});
			results.push(...(response.contents ?? []).map((obj) => obj.key).filter(Boolean) as string[]);
			token = response.nextContinuationToken ?? undefined;
		} while (token);
		return results;
	}

	async allFiles(directory: string): Promise<string[]> {
		const prefix = directory.replace(/\/$/, '') + '/';
		const results: string[] = [];
		let token: string | undefined;
		do {
			const response = await this.client.list({
				prefix,
				...(token ? { continuationToken: token } : {})
			});
			results.push(...(response.contents ?? []).map((obj) => obj.key).filter(Boolean) as string[]);
			token = response.nextContinuationToken ?? undefined;
		} while (token);
		return results;
	}

	async size(path: string): Promise<number> {
		const s = await this.client.file(path).stat();
		return s.size;
	}

	async lastModified(path: string): Promise<Date> {
		const s = await this.client.file(path).stat();
		return new Date(s.lastModified);
	}

	async mimeType(path: string): Promise<string> {
		const s = await this.client.file(path).stat();
		return s.type;
	}

	async getNullable(path: string): Promise<Uint8Array | null> {
		if (!await this.exists(path)) return null;
		return this.get(path);
	}

	async getTextNullable(path: string): Promise<string | null> {
		if (!await this.exists(path)) return null;
		return this.getText(path);
	}

	async makeDirectory(_directory: string): Promise<void> {
		// S3 has no real directories — no-op
	}

	bucket(name: string): S3Driver {
		return new S3Driver({ ...this.config, bucket: name });
	}
}
