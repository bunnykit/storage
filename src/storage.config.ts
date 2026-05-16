import type { DiskConfig } from './types';

const env = Bun.env;

const disks = {
	local: {
		driver: 'local' as const,
		root: env.STORAGE_LOCAL_ROOT ?? 'data/storage',
		publicUrl: env.STORAGE_LOCAL_URL ?? '/storage'
	},

	r2: {
		driver: 's3' as const,
		bucket: env.R2_BUCKET ?? '',
		accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
		secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
		endpoint: env.R2_ACCOUNT_ID
			? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
			: undefined,
		publicUrl: env.R2_PUBLIC_URL
	}
} satisfies Record<string, DiskConfig>;

/** Union of disk names defined in storage.config.ts. */
export type BuiltInDiskName = keyof typeof disks;

const config: {
	default: BuiltInDiskName | (string & {});
	disks: Record<string, DiskConfig | Record<string, unknown>>;
} = {
	default: (env.STORAGE_DISK ?? 'local') as BuiltInDiskName,
	disks
};

export default config;
