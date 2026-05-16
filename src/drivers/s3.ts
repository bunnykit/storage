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

	async putFile(directory: string, file: File, name?: string): Promise<string> {
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

	async files(directory: string): Promise<string[]> {
		const response = await this.client.list({ prefix: directory.replace(/\/$/, '') + '/' });
		return (response.contents ?? []).map((obj) => obj.key).filter(Boolean) as string[];
	}

	async makeDirectory(_directory: string): Promise<void> {
		// S3 has no real directories — no-op
	}
}
