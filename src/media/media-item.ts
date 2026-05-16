import type { AttachmentAttributes } from './attachment-model';
import type { StorageDriver } from '../types';

export class MediaItem {
	readonly id: string;
	readonly collection: string;
	readonly disk: string;
	readonly path: string;
	readonly originalName: string;
	readonly mimeType: string;
	readonly sizeBytes: number;
	readonly visibility: 'public' | 'private';
	readonly metadata: Record<string, unknown> | null;
	readonly sortOrder: number;
	readonly uploadedById: string | null;
	readonly createdAt: string | null;
	readonly updatedAt: string | null;

	constructor(
		private readonly attrs: AttachmentAttributes,
		private readonly driver: StorageDriver
	) {
		this.id = attrs.id;
		this.collection = attrs.collection;
		this.disk = attrs.provider;
		this.path = attrs.key;
		this.originalName = attrs.original_name;
		this.mimeType = attrs.mime_type;
		this.sizeBytes = attrs.size_bytes;
		this.visibility = attrs.visibility;
		this.metadata = attrs.metadata ? JSON.parse(attrs.metadata) : null;
		this.sortOrder = attrs.sort_order;
		this.uploadedById = attrs.uploaded_by_id ?? null;
		this.createdAt = attrs.created_at ?? null;
		this.updatedAt = attrs.updated_at ?? null;
	}

	/** Public URL for this file. */
	url(): string {
		return this.driver.url(this.path);
	}

	/** Presigned temporary URL. */
	temporaryUrl(expiresInSeconds = 3600): Promise<string> {
		return this.driver.temporaryUrl(this.path, expiresInSeconds);
	}

	/** Raw attachment attributes. */
	toJSON(): AttachmentAttributes {
		return this.attrs;
	}
}
