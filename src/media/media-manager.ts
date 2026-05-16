import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import Attachment from './attachment-model';
import { MediaItem } from './media-item';
import type { StorageDriver } from '../types';

interface StorageFacade {
	disk(name?: string): StorageDriver;
	readonly defaultDisk: string;
}

export interface Attachable {
	id: string;
	constructor: Function;
}

export interface PutOptions {
	/** Storage collection name (e.g. 'avatar', 'documents'). Default: 'default'. */
	collection?: string;
	/** Disk name. Falls back to StorageManager default. */
	disk?: string;
	/** Override stored filename (without extension). */
	name?: string;
	/** File visibility. Default: 'private'. */
	visibility?: 'public' | 'private';
	/** If true, deletes all existing files in the collection before uploading. */
	single?: boolean;
	/** Arbitrary metadata to store alongside the record. */
	metadata?: Record<string, unknown>;
	/** ID of the user performing the upload. */
	uploadedById?: string | null;
}

function getModelType(model: Attachable): string {
	const ctor = model.constructor as { table?: string; getTable?(): string; name: string };
	return ctor.table ?? ctor.getTable?.() ?? ctor.name.toLowerCase();
}

async function checksumOf(file: File): Promise<string> {
	const buf = await file.arrayBuffer();
	return createHash('sha256').update(new Uint8Array(buf)).digest('hex');
}

export class MediaManager {
	constructor(
		private readonly model: Attachable,
		private readonly storage: StorageFacade
	) {}

	private driver(disk?: string) {
		return this.storage.disk(disk);
	}

	/**
	 * Upload a File and record it in the database.
	 * Returns the created MediaItem.
	 */
	async put(file: File, options: PutOptions = {}): Promise<MediaItem> {
		const {
			collection = 'default',
			disk,
			name,
			visibility = 'private',
			single = false,
			metadata,
			uploadedById = null
		} = options;

		if (single) {
			const existing = await this.all(collection);
			for (const item of existing) {
				await this.delete(item.id);
			}
		}

		const driver = this.driver(disk);
		const diskName = disk ?? this.storage.defaultDisk;
		const ext = extname(file.name) || `.${file.type.split('/')[1] ?? 'bin'}`;
		const filename = (name ?? randomUUID()) + ext;
		const directory = `${getModelType(this.model)}/${collection}`;
		const key = await driver.putFile(directory, file, name ?? randomUUID());
		const hash = await checksumOf(file);

		const attachment = await Attachment.create({
			id: randomUUID(),
			attachable_type: getModelType(this.model),
			attachable_id: this.model.id,
			collection,
			provider: diskName,
			bucket_name: '',
			key,
			original_name: file.name || filename,
			mime_type: file.type || 'application/octet-stream',
			size_bytes: file.size,
			checksum: hash,
			visibility,
			sort_order: 0,
			uploaded_by_id: uploadedById,
			metadata: metadata ? JSON.stringify(metadata) : null
		});

		return new MediaItem(attachment.$attributes, driver);
	}

	/**
	 * Upload from a URL — fetches, stores, and records in one step.
	 */
	async putFromUrl(url: string, options: PutOptions = {}): Promise<MediaItem> {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Failed to fetch "${url}": ${response.status}`);
		const blob = await response.blob();
		const filename = url.split('/').pop()?.split('?')[0] ?? 'file';
		const file = new File([blob], filename, { type: blob.type });
		return this.put(file, options);
	}

	/**
	 * Record an already-stored file path without uploading.
	 */
	async record(
		path: string,
		attrs: { originalName: string; mimeType: string; sizeBytes: number } & PutOptions
	): Promise<MediaItem> {
		const {
			collection = 'default',
			disk,
			visibility = 'private',
			metadata,
			uploadedById = null,
			originalName,
			mimeType,
			sizeBytes
		} = attrs;

		const driver = this.driver(disk);
		const diskName = disk ?? this.storage.defaultDisk;

		const attachment = await Attachment.create({
			id: randomUUID(),
			attachable_type: getModelType(this.model),
			attachable_id: this.model.id,
			collection,
			provider: diskName,
			bucket_name: '',
			key: path,
			original_name: originalName,
			mime_type: mimeType,
			size_bytes: sizeBytes,
			visibility,
			sort_order: 0,
			uploaded_by_id: uploadedById,
			metadata: metadata ? JSON.stringify(metadata) : null
		});

		return new MediaItem(attachment.$attributes, driver);
	}

	/** Get first attachment in a collection. */
	async first(collection = 'default'): Promise<MediaItem | null> {
		const row = await Attachment.where('attachable_type', getModelType(this.model))
			.where('attachable_id', this.model.id)
			.where('collection', collection)
			.whereNull('deleted_at')
			.orderBy('sort_order', 'asc')
			.first();

		if (!row) return null;
		return new MediaItem(row.$attributes, this.driver(row.provider));
	}

	/** Get all attachments in a collection. */
	async all(collection = 'default'): Promise<MediaItem[]> {
		const rows = await Attachment.where('attachable_type', getModelType(this.model))
			.where('attachable_id', this.model.id)
			.where('collection', collection)
			.whereNull('deleted_at')
			.orderBy('sort_order', 'asc')
			.get();

		return rows.map((row) => new MediaItem(row.$attributes, this.driver(row.provider)));
	}

	/** Soft-delete DB record and remove file from storage. */
	async delete(mediaId: string): Promise<void> {
		const row = await Attachment.find(mediaId);
		if (!row) return;

		await this.driver(row.provider).delete(row.key);
		await row.update({ deleted_at: new Date().toISOString() });
	}

	/**
	 * Delete all existing attachments in a collection, then upload the new file.
	 * Useful for single-file collections like avatars.
	 */
	async replace(file: File, options: PutOptions = {}): Promise<MediaItem> {
		const collection = options.collection ?? 'default';
		const existing = await this.all(collection);
		for (const item of existing) {
			await this.delete(item.id);
		}
		return this.put(file, options);
	}

	/** Permanently hard-delete a record and its file. */
	async purge(mediaId: string): Promise<void> {
		const row = await Attachment.find(mediaId);
		if (!row) return;

		await this.driver(row.provider).delete(row.key);
		await row.delete();
	}
}
