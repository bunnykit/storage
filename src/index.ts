import { LocalDriver } from './drivers/local';
import { S3Driver } from './drivers/s3';
import storageConfig, { type BuiltInDiskName } from './storage.config';
import type { MediaManager, Attachable } from './media/media-manager';
import type { DiskConfig, StorageDriver } from './types';

export type DriverFactory<C = unknown> = (config: C) => StorageDriver;

function makeDriver(config: DiskConfig): StorageDriver {
	if (config.driver === 's3') return new S3Driver(config);
	return new LocalDriver(config);
}

class StorageManager<TDisks extends string = BuiltInDiskName> {
	private readonly _drivers = new Map<string, StorageDriver>();
	private readonly _factories = new Map<string, DriverFactory>();
	private readonly _diskConfigs = new Map<string, unknown>();

	/**
	 * Register a custom driver factory.
	 *
	 * @example
	 * Storage.extend('gcs', (config) => new GCSDriver(config));
	 */
	extend<C>(driverName: string, factory: DriverFactory<C>): this {
		this._factories.set(driverName, factory as DriverFactory);
		return this;
	}

	/**
	 * Register a named disk. Invalidates any cached driver instance for that name.
	 * Returns a typed manager that includes the new disk name for autocomplete.
	 *
	 * @example
	 * const TypedStorage = Storage.addDisk('minio', { driver: 's3', bucket: '...' });
	 * TypedStorage.disk('minio'); // autocompleted
	 */
	addDisk<N extends string>(
		name: N,
		config: DiskConfig | Record<string, unknown>
	): StorageManager<TDisks | N> {
		this._diskConfigs.set(name, config);
		this._drivers.delete(name);
		return this as unknown as StorageManager<TDisks | N>;
	}

	/** The name of the default disk. */
	get defaultDisk(): string {
		return storageConfig.default;
	}

	/**
	 * Resolve a disk driver by name.
	 * Omit `name` to use the default disk (`STORAGE_DISK` env, fallback `'local'`).
	 */
	disk(name?: TDisks | (string & {})): StorageDriver {
		const diskName = name ?? storageConfig.default;
		if (!this._drivers.has(diskName)) {
			const raw = this._diskConfigs.get(diskName) ?? storageConfig.disks[diskName];
			if (!raw) throw new Error(`Storage disk "${diskName}" is not configured.`);
			const config = raw as DiskConfig & Record<string, unknown>;
			const factory = this._factories.get(config.driver);
			this._drivers.set(diskName, factory ? factory(config) : makeDriver(config as DiskConfig));
		}
		return this._drivers.get(diskName)!;
	}

	/** Write a file to the default disk. */
	put(path: string, contents: string | Uint8Array | ArrayBuffer | Blob) {
		return this.disk().put(path, contents);
	}

	/** Store a File object on the default disk. Returns the stored path. */
	putFile(directory: string, file: File, name?: string) {
		return this.disk().putFile(directory, file, name);
	}

	/** Read a file as raw bytes from the default disk. */
	get(path: string) {
		return this.disk().get(path);
	}

	/** Read a file as a string from the default disk. */
	getText(path: string) {
		return this.disk().getText(path);
	}

	/** Delete a file from the default disk. */
	delete(path: string) {
		return this.disk().delete(path);
	}

	/** Check whether a file exists on the default disk. */
	exists(path: string) {
		return this.disk().exists(path);
	}

	/** Return the public URL for a file on the default disk. */
	url(path: string) {
		return this.disk().url(path);
	}

	/** Return a presigned URL for a file on the default disk. */
	temporaryUrl(path: string, expiresInSeconds?: number) {
		return this.disk().temporaryUrl(path, expiresInSeconds);
	}

	/** List files in a directory on the default disk. */
	files(directory: string) {
		return this.disk().files(directory);
	}

	/** Create a directory on the default disk. */
	makeDirectory(directory: string) {
		return this.disk().makeDirectory(directory);
	}
}

const Storage = new StorageManager();

/**
 * Shortcut to resolve a storage disk driver.
 * Omit `disk` to use the default disk (`STORAGE_DISK` env, fallback `'local'`).
 *
 * @example
 * await storage().put('logos/file.png', buffer);
 * await storage('r2').putFile('logos', file);
 */
export function storage(disk?: BuiltInDiskName | (string & {})): StorageDriver {
	return Storage.disk(disk);
}

/**
 * Get a MediaManager for a model instance.
 * Handles upload, storage, and database recording in one step.
 *
 * @example
 * await media(user).put(file, { collection: 'avatar' });
 * await media(user).replace(file, { collection: 'avatar' });
 * const avatar = await media(user).first('avatar');
 * avatar.url();
 * await media(student).all('documents');
 * await media(user).delete(mediaId);
 */
export async function media(model: Attachable): Promise<MediaManager> {
	const { MediaManager } = await import('./media/media-manager');
	return new MediaManager(model, Storage);
}

export default Storage;
export { Storage };
export type { StorageDriver, DiskConfig } from './types';
export type { BuiltInDiskName } from './storage.config';
export type { Attachable, PutOptions } from './media/media-manager';
export { MediaItem } from './media/media-item';
