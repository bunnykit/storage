import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StorageDriver, LocalDiskConfig } from '../types';

export class LocalDriver implements StorageDriver {
	constructor(private readonly config: LocalDiskConfig) {}

	private resolve(path: string): string {
		return join(this.config.root, path.replace(/^\/+/, ''));
	}

	async put(path: string, contents: string | Uint8Array | ArrayBuffer | Blob): Promise<void> {
		const full = this.resolve(path);
		await mkdir(dirname(full), { recursive: true });
		if (contents instanceof Blob) {
			await writeFile(full, Buffer.from(await contents.arrayBuffer()));
		} else if (contents instanceof ArrayBuffer) {
			await writeFile(full, Buffer.from(contents));
		} else {
			await writeFile(full, contents as string | Uint8Array);
		}
	}

	async putFile(directory: string, file: File, name?: string): Promise<string> {
		const ext = extname(file.name) || `.${file.type.split('/')[1] ?? 'bin'}`;
		const filename = (name ?? randomUUID()) + ext;
		const path = `${directory.replace(/\/$/, '')}/${filename}`;
		await this.put(path, file);
		return path;
	}

	async get(path: string): Promise<Uint8Array> {
		return readFile(this.resolve(path));
	}

	getStream(path: string): ReadableStream<Uint8Array> {
		return Bun.file(this.resolve(path)).stream();
	}

	async putStream(path: string, stream: ReadableStream<Uint8Array>): Promise<void> {
		const full = this.resolve(path);
		await mkdir(dirname(full), { recursive: true });
		const writer = Bun.file(full).writer();
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

	async getText(path: string): Promise<string> {
		return readFile(this.resolve(path), 'utf8');
	}

	async delete(path: string): Promise<void> {
		await unlink(this.resolve(path));
	}

	async exists(path: string): Promise<boolean> {
		return existsSync(this.resolve(path));
	}

	url(path: string): string {
		const base = this.config.publicUrl?.replace(/\/$/, '') ?? '';
		return `${base}/${path.replace(/^\/+/, '')}`;
	}

	async temporaryUrl(path: string, _expiresInSeconds?: number): Promise<string> {
		return this.url(path);
	}

	async files(directory: string): Promise<string[]> {
		const full = this.resolve(directory);
		const entries = await readdir(full, { withFileTypes: true });
		const dir = directory.replace(/\/$/, '');
		return entries.filter((e) => e.isFile()).map((e) => `${dir}/${e.name}`);
	}

	async makeDirectory(directory: string): Promise<void> {
		await mkdir(this.resolve(directory), { recursive: true });
	}
}
