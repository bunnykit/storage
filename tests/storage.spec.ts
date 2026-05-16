import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDriver } from '../src/drivers/local';
import { S3Driver } from '../src/drivers/s3';
import type { StorageDriver } from '../src/types';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTmpDriver(root: string, publicUrl = 'http://localhost/storage') {
	return new LocalDriver({ driver: 'local', root, publicUrl });
}

function makeFile(name: string, content: string, type = 'text/plain') {
	return new File([content], name, { type });
}

function mockDriver(): StorageDriver & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		put: mock(async () => { calls.push('put'); }),
		putFile: mock(async () => { calls.push('putFile'); return 'dir/file.txt'; }),
		get: mock(async () => { calls.push('get'); return new Uint8Array(); }),
		getText: mock(async () => { calls.push('getText'); return ''; }),
		copy: mock(async () => { calls.push('copy'); }),
		move: mock(async () => { calls.push('move'); }),
		delete: mock(async () => { calls.push('delete'); }),
		exists: mock(async () => { calls.push('exists'); return true; }),
		url: mock(() => { calls.push('url'); return 'http://example.com/file'; }),
		temporaryUrl: mock(async () => { calls.push('temporaryUrl'); return 'http://example.com/signed'; }),
		files: mock(async () => { calls.push('files'); return []; }),
		allFiles: mock(async () => { calls.push('allFiles'); return []; }),
		size: mock(async () => { calls.push('size'); return 0; }),
		lastModified: mock(async () => { calls.push('lastModified'); return new Date(); }),
		mimeType: mock(async () => { calls.push('mimeType'); return 'text/plain'; }),
		getNullable: mock(async () => { calls.push('getNullable'); return null; }),
		getTextNullable: mock(async () => { calls.push('getTextNullable'); return null; }),
		makeDirectory: mock(async () => { calls.push('makeDirectory'); }),
		getStream: mock(() => { calls.push('getStream'); return new ReadableStream(); }),
		putStream: mock(async () => { calls.push('putStream'); })
	};
}

// ── LocalDriver ───────────────────────────────────────────────────────────────

describe('LocalDriver', () => {
	let root: string;
	let driver: LocalDriver;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'storage-test-'));
		driver = makeTmpDriver(root);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	describe('put / get / getText', () => {
		it('stores and retrieves a string', async () => {
			await driver.put('hello.txt', 'world');
			expect(await driver.getText('hello.txt')).toBe('world');
		});

		it('stores and retrieves a Uint8Array', async () => {
			const bytes = new TextEncoder().encode('binary');
			await driver.put('data.bin', bytes);
			const result = await driver.get('data.bin');
			expect(new TextDecoder().decode(result)).toBe('binary');
		});

		it('stores and retrieves an ArrayBuffer', async () => {
			const buf = new TextEncoder().encode('buffer').buffer;
			await driver.put('buf.bin', buf);
			const result = await driver.get('buf.bin');
			expect(new TextDecoder().decode(result)).toBe('buffer');
		});

		it('stores and retrieves a Blob', async () => {
			const blob = new Blob(['blob content'], { type: 'text/plain' });
			await driver.put('blob.txt', blob);
			expect(await driver.getText('blob.txt')).toBe('blob content');
		});

		it('creates intermediate directories automatically', async () => {
			await driver.put('a/b/c/deep.txt', 'deep');
			expect(await driver.getText('a/b/c/deep.txt')).toBe('deep');
		});
	});

	describe('putFile', () => {
		it('stores a File and returns the path', async () => {
			const file = makeFile('photo.png', 'imgdata', 'image/png');
			const path = await driver.putFile('uploads', file);
			expect(path).toMatch(/^uploads\/.+\.png$/);
			expect(await driver.exists(path)).toBe(true);
		});

		it('uses provided name when given', async () => {
			const file = makeFile('orig.png', 'imgdata', 'image/png');
			const path = await driver.putFile('uploads', file, 'avatar');
			expect(path).toBe('uploads/avatar.png');
		});

		it('falls back to mime type extension when filename has none', async () => {
			const file = makeFile('noext', 'data', 'image/jpeg');
			const path = await driver.putFile('uploads', file);
			expect(path).toMatch(/\.jpeg$/);
		});
	});

	describe('exists', () => {
		it('returns true for existing file', async () => {
			await driver.put('exists.txt', 'yes');
			expect(await driver.exists('exists.txt')).toBe(true);
		});

		it('returns false for missing file', async () => {
			expect(await driver.exists('missing.txt')).toBe(false);
		});
	});

	describe('delete', () => {
		it('removes the file', async () => {
			await driver.put('del.txt', 'bye');
			await driver.delete('del.txt');
			expect(await driver.exists('del.txt')).toBe(false);
		});
	});

	describe('url', () => {
		it('builds URL from publicUrl + path', () => {
			expect(driver.url('logos/img.png')).toBe('http://localhost/storage/logos/img.png');
		});

		it('strips leading slash from path', () => {
			expect(driver.url('/logos/img.png')).toBe('http://localhost/storage/logos/img.png');
		});
	});

	describe('temporaryUrl', () => {
		it('returns same as url() for local driver', async () => {
			expect(await driver.temporaryUrl('logos/img.png')).toBe(driver.url('logos/img.png'));
		});
	});

	describe('files', () => {
		it('lists files in a directory', async () => {
			await driver.put('docs/a.txt', 'a');
			await driver.put('docs/b.txt', 'b');
			const list = await driver.files('docs');
			expect(list).toHaveLength(2);
			expect(list).toContain('docs/a.txt');
			expect(list).toContain('docs/b.txt');
		});

		it('does not include subdirectories', async () => {
			await driver.put('dir/file.txt', 'f');
			await driver.put('dir/sub/nested.txt', 'n');
			const list = await driver.files('dir');
			expect(list).toEqual(['dir/file.txt']);
		});
	});

	describe('allFiles', () => {
		it('lists files recursively', async () => {
			await driver.put('root.txt', 'r');
			await driver.put('a/b.txt', 'b');
			await driver.put('a/c/d.txt', 'd');
			const list = await driver.allFiles('.');
			expect(list).toContain('./root.txt');
			expect(list).toContain('./a/b.txt');
			expect(list).toContain('./a/c/d.txt');
		});

		it('only returns files not directories', async () => {
			await driver.put('x/y/z.txt', 'z');
			const list = await driver.allFiles('x');
			expect(list).toEqual(['x/y/z.txt']);
		});
	});

	describe('size', () => {
		it('returns file size in bytes', async () => {
			await driver.put('sized.txt', 'hello');
			expect(await driver.size('sized.txt')).toBe(5);
		});
	});

	describe('lastModified', () => {
		it('returns a Date', async () => {
			await driver.put('dated.txt', 'ts');
			const d = await driver.lastModified('dated.txt');
			expect(d).toBeInstanceOf(Date);
			expect(d.getTime()).toBeLessThanOrEqual(Date.now());
		});
	});

	describe('mimeType', () => {
		it('returns correct mime type for known extension', async () => {
			await driver.put('img.png', 'fake');
			expect(await driver.mimeType('img.png')).toBe('image/png');
		});

		it('returns text/plain for .txt', async () => {
			await driver.put('file.txt', 'text');
			expect(await driver.mimeType('file.txt')).toBe('text/plain;charset=utf-8');
		});
	});

	describe('getNullable', () => {
		it('returns bytes for existing file', async () => {
			await driver.put('exists.txt', 'data');
			const result = await driver.getNullable('exists.txt');
			expect(result).not.toBeNull();
			expect(new TextDecoder().decode(result!)).toBe('data');
		});

		it('returns null for missing file', async () => {
			expect(await driver.getNullable('ghost.txt')).toBeNull();
		});
	});

	describe('getTextNullable', () => {
		it('returns string for existing file', async () => {
			await driver.put('exists.txt', 'hello');
			expect(await driver.getTextNullable('exists.txt')).toBe('hello');
		});

		it('returns null for missing file', async () => {
			expect(await driver.getTextNullable('ghost.txt')).toBeNull();
		});
	});

	describe('copy', () => {
		it('copies file to new path, original remains', async () => {
			await driver.put('original.txt', 'content');
			await driver.copy('original.txt', 'copy.txt');
			expect(await driver.getText('copy.txt')).toBe('content');
			expect(await driver.exists('original.txt')).toBe(true);
		});

		it('creates intermediate directories at destination', async () => {
			await driver.put('src.txt', 'data');
			await driver.copy('src.txt', 'a/b/c/dest.txt');
			expect(await driver.getText('a/b/c/dest.txt')).toBe('data');
		});
	});

	describe('move', () => {
		it('moves file to new path, original removed', async () => {
			await driver.put('before.txt', 'moved');
			await driver.move('before.txt', 'after.txt');
			expect(await driver.getText('after.txt')).toBe('moved');
			expect(await driver.exists('before.txt')).toBe(false);
		});

		it('creates intermediate directories at destination', async () => {
			await driver.put('flat.txt', 'deep');
			await driver.move('flat.txt', 'x/y/z/nested.txt');
			expect(await driver.getText('x/y/z/nested.txt')).toBe('deep');
			expect(await driver.exists('flat.txt')).toBe(false);
		});
	});

	describe('getStream', () => {
		it('returns a ReadableStream of the file contents', async () => {
			await driver.put('stream.txt', 'streamed content');
			const stream = driver.getStream('stream.txt');
			const reader = stream.getReader();
			const chunks: Uint8Array[] = [];
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
			}
			const result = new TextDecoder().decode(
				chunks.reduce((acc, c) => {
					const merged = new Uint8Array(acc.length + c.length);
					merged.set(acc);
					merged.set(c, acc.length);
					return merged;
				}, new Uint8Array())
			);
			expect(result).toBe('streamed content');
		});
	});

	describe('putStream', () => {
		it('writes stream contents to a file', async () => {
			const data = new TextEncoder().encode('written via stream');
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(data);
					controller.close();
				}
			});
			await driver.putStream('streamed.txt', stream);
			expect(await driver.getText('streamed.txt')).toBe('written via stream');
		});

		it('writes multiple chunks correctly', async () => {
			const chunks = ['hello', ' ', 'world'].map((s) => new TextEncoder().encode(s));
			let i = 0;
			const stream = new ReadableStream<Uint8Array>({
				pull(controller) {
					if (i < chunks.length) controller.enqueue(chunks[i++]);
					else controller.close();
				}
			});
			await driver.putStream('multi-chunk.txt', stream);
			expect(await driver.getText('multi-chunk.txt')).toBe('hello world');
		});

		it('creates intermediate directories automatically', async () => {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('deep'));
					controller.close();
				}
			});
			await driver.putStream('a/b/c/streamed.txt', stream);
			expect(await driver.getText('a/b/c/streamed.txt')).toBe('deep');
		});
	});

	describe('makeDirectory', () => {
		it('creates directory without error', async () => {
			expect(await driver.makeDirectory('new/nested/dir')).toBeUndefined();
		});

		it('is idempotent', async () => {
			await driver.makeDirectory('idempotent');
			expect(await driver.makeDirectory('idempotent')).toBeUndefined();
		});
	});
});

// ── S3Driver.bucket() ─────────────────────────────────────────────────────────

describe('S3Driver.bucket()', () => {
	function makeS3Driver(overrides: Partial<Parameters<typeof S3Driver.prototype.bucket>[0]> = {}) {
		return new S3Driver({
			driver: 's3',
			bucket: 'original-bucket',
			accessKeyId: 'key',
			secretAccessKey: 'secret',
			endpoint: 'https://s3.example.com',
			...overrides
		});
	}

	it('returns a new S3Driver instance', () => {
		const driver = makeS3Driver();
		const other = driver.bucket('tenant-bucket');
		expect(other).toBeInstanceOf(S3Driver);
		expect(other).not.toBe(driver);
	});

	it('does not mutate the original driver', () => {
		const driver = makeS3Driver();
		driver.bucket('other-bucket');
		expect(driver.url('file.txt')).toContain('original-bucket');
	});

	it('uses overridden bucket in URL generation', () => {
		const driver = makeS3Driver({ endpoint: 'https://s3.example.com' });
		const tenant = driver.bucket('tenant-bucket');
		expect(tenant.url('avatar.png')).toContain('tenant-bucket');
		expect(tenant.url('avatar.png')).not.toContain('original-bucket');
	});

	it('inherits all other config (endpoint, credentials)', () => {
		const driver = makeS3Driver({ endpoint: 'https://s3.example.com' });
		const tenant = driver.bucket('tenant-bucket');
		expect(tenant.url('f.txt')).toContain('https://s3.example.com');
	});

	it('inherits publicUrl from parent', () => {
		const driver = makeS3Driver({ publicUrl: 'https://cdn.example.com' });
		const tenant = driver.bucket('tenant-bucket');
		expect(tenant.url('file.txt')).toBe('https://cdn.example.com/file.txt');
	});

	it('chained calls produce independent drivers', () => {
		const base = makeS3Driver({ endpoint: 'https://s3.example.com' });
		const t1 = base.bucket('tenant-1');
		const t2 = base.bucket('tenant-2');
		expect(t1.url('f.txt')).toContain('tenant-1');
		expect(t2.url('f.txt')).toContain('tenant-2');
		expect(base.url('f.txt')).toContain('original-bucket');
	});

	it('bucket name appears in URL when no publicUrl', () => {
		const driver = new S3Driver({
			driver: 's3',
			bucket: 'base',
			accessKeyId: 'k',
			secretAccessKey: 's',
			endpoint: 'https://s3.example.com'
		});
		const url = driver.bucket('acme-corp').url('logo.png');
		expect(url).toBe('https://s3.example.com/acme-corp/logo.png');
	});
});

// ── s3() helper ───────────────────────────────────────────────────────────────

describe('s3() helper', () => {
	it('returns S3Driver for an S3 disk', async () => {
		const { Storage, s3 } = await import('../src/index');
		Storage.addDisk('s3-helper-test', {
			driver: 's3',
			bucket: 'test-bucket',
			accessKeyId: 'key',
			secretAccessKey: 'secret',
			endpoint: 'https://s3.example.com'
		});
		expect(s3('s3-helper-test')).toBeInstanceOf(S3Driver);
	});

	it('throws for a non-S3 disk', async () => {
		const { Storage, s3 } = await import('../src/index');
		Storage.addDisk('local-only', { driver: 'local', root: '/tmp', publicUrl: '' });
		expect(() => s3('local-only')).toThrow('is not an S3 disk');
	});

	it('error message includes disk name', async () => {
		const { Storage, s3 } = await import('../src/index');
		Storage.addDisk('not-s3-disk', { driver: 'local', root: '/tmp', publicUrl: '' });
		expect(() => s3('not-s3-disk')).toThrow('not-s3-disk');
	});

	it('.bucket() returns driver using overridden bucket in URL', async () => {
		const { Storage, s3 } = await import('../src/index');
		Storage.addDisk('s3-bucket-override', {
			driver: 's3',
			bucket: 'original',
			accessKeyId: 'key',
			secretAccessKey: 'secret',
			endpoint: 'https://s3.example.com'
		});
		const tenant = s3('s3-bucket-override').bucket('tenant-abc');
		expect(tenant.url('file.txt')).toContain('tenant-abc');
		expect(tenant.url('file.txt')).not.toContain('original');
	});

	it('multiple .bucket() calls from same base are independent', async () => {
		const { Storage, s3 } = await import('../src/index');
		Storage.addDisk('s3-multi-tenant', {
			driver: 's3',
			bucket: 'default',
			accessKeyId: 'key',
			secretAccessKey: 'secret',
			endpoint: 'https://s3.example.com'
		});
		const base = s3('s3-multi-tenant');
		const a = base.bucket('tenant-a');
		const b = base.bucket('tenant-b');
		expect(a.url('f.txt')).toContain('tenant-a');
		expect(b.url('f.txt')).toContain('tenant-b');
		expect(base.url('f.txt')).toContain('default');
	});

	it('throws for unknown disk name', async () => {
		const { s3 } = await import('../src/index');
		expect(() => s3('__no-such-s3-disk__')).toThrow();
	});
});

// ── StorageManager ────────────────────────────────────────────────────────────

describe('StorageManager', () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'storage-mgr-'));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('disk() with no arg uses default disk from config', async () => {
		const { Storage, storage } = await import('../src/index');
		const driver = mockDriver();
		Storage.extend('noop', () => driver);
		Storage.addDisk('local', { driver: 'noop' });
		storage().url('f.txt');
		expect(driver.url).toHaveBeenCalledWith('f.txt');
	});

	it('defaultDisk returns config default', async () => {
		const { Storage } = await import('../src/index');
		expect(typeof Storage.defaultDisk).toBe('string');
		expect(Storage.defaultDisk.length).toBeGreaterThan(0);
	});

	it('throws for unknown disk', async () => {
		const { storage } = await import('../src/index');
		expect(() => storage('__nonexistent__')).toThrow('Storage disk "__nonexistent__" is not configured.');
	});

	it('returns same instance on repeated disk() calls (cached)', async () => {
		const { storage } = await import('../src/index');
		expect(storage('local')).toBe(storage('local'));
	});

	it('extend() registers a custom driver factory', async () => {
		const { Storage } = await import('../src/index');
		const driver = mockDriver();
		Storage.extend('mock-ext', () => driver);
		Storage.addDisk('mock-disk-ext', { driver: 'mock-ext' });
		expect(Storage.disk('mock-disk-ext')).toBe(driver);
	});

	it('addDisk() invalidates cached driver instance', async () => {
		const { Storage } = await import('../src/index');
		const first = mockDriver();
		const second = mockDriver();

		Storage.extend('swappable', () => first);
		Storage.addDisk('swap-disk', { driver: 'swappable' });
		expect(Storage.disk('swap-disk')).toBe(first);

		Storage.extend('swappable', () => second);
		Storage.addDisk('swap-disk', { driver: 'swappable' });
		expect(Storage.disk('swap-disk')).toBe(second);
	});

	it('facade shortcut methods delegate to default disk', async () => {
		const { Storage } = await import('../src/index');
		const driver = mockDriver();
		Storage.extend('delegate2', () => driver);
		Storage.addDisk('local', { driver: 'delegate2' });

		const buf = new Uint8Array([1]);
		const file = makeFile('f.txt', 'x');

		await Storage.put('f.txt', buf);
		await Storage.putFile('dir', file);
		await Storage.get('f.txt');
		await Storage.getText('f.txt');
		await Storage.delete('f.txt');
		await Storage.exists('f.txt');
		Storage.url('f.txt');
		await Storage.temporaryUrl('f.txt');
		await Storage.files('dir');
		await Storage.makeDirectory('dir');

		expect(driver.put).toHaveBeenCalledWith('f.txt', buf);
		expect(driver.putFile).toHaveBeenCalledWith('dir', file, undefined);
		expect(driver.get).toHaveBeenCalledWith('f.txt');
		expect(driver.getText).toHaveBeenCalledWith('f.txt');
		expect(driver.delete).toHaveBeenCalledWith('f.txt');
		expect(driver.exists).toHaveBeenCalledWith('f.txt');
		expect(driver.url).toHaveBeenCalledWith('f.txt');
		expect(driver.temporaryUrl).toHaveBeenCalledWith('f.txt', undefined);
		expect(driver.files).toHaveBeenCalledWith('dir');
		expect(driver.makeDirectory).toHaveBeenCalledWith('dir');
	});

	it('putFromUrl fetches and stores file', async () => {
		const { Storage } = await import('../src/index');
		Storage.addDisk('local', { driver: 'local', root, publicUrl: 'http://localhost/storage' });

		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async () =>
			new Response(new Blob(['fetched content'], { type: 'text/plain' }), { status: 200 })
		) as unknown as typeof fetch;

		const path = await Storage.putFromUrl('https://example.com/report.txt', 'downloads');
		expect(path).toMatch(/^downloads\/.+\.txt$/);
		expect(await Storage.getText(path)).toBe('fetched content');

		globalThis.fetch = originalFetch;
	});

	it('putFromUrl throws on non-200 response', async () => {
		const { Storage } = await import('../src/index');

		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;

		await expect(Storage.putFromUrl('https://example.com/missing.txt', 'downloads')).rejects.toThrow(
			'Failed to fetch "https://example.com/missing.txt": 404'
		);

		globalThis.fetch = originalFetch;
	});

	it('putFromUrl uses provided name', async () => {
		const { Storage } = await import('../src/index');
		Storage.addDisk('local', { driver: 'local', root, publicUrl: 'http://localhost/storage' });

		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async () =>
			new Response(new Blob(['data'], { type: 'text/plain' }), { status: 200 })
		) as unknown as typeof fetch;

		const path = await Storage.putFromUrl('https://example.com/file.txt', 'downloads', 'custom');
		expect(path).toBe('downloads/custom.txt');

		globalThis.fetch = originalFetch;
	});

	it('copyAcross copies file from one disk to another', async () => {
		const { Storage } = await import('../src/index');
		const root2 = await mkdtemp(join(tmpdir(), 'storage-disk2-'));
		try {
			Storage.addDisk('disk-a', { driver: 'local', root, publicUrl: '' });
			Storage.addDisk('disk-b', { driver: 'local', root: root2, publicUrl: '' });

			await Storage.disk('disk-a').put('report.txt', 'cross-disk content');
			await Storage.copyAcross('disk-a', 'report.txt', 'disk-b', 'archive/report.txt');

			expect(await Storage.disk('disk-b').getText('archive/report.txt')).toBe('cross-disk content');
			expect(await Storage.disk('disk-a').exists('report.txt')).toBe(true);
		} finally {
			await rm(root2, { recursive: true, force: true });
		}
	});

	it('moveAcross moves file from one disk to another, removes source', async () => {
		const { Storage } = await import('../src/index');
		const root2 = await mkdtemp(join(tmpdir(), 'storage-disk2-'));
		try {
			Storage.addDisk('disk-c', { driver: 'local', root, publicUrl: '' });
			Storage.addDisk('disk-d', { driver: 'local', root: root2, publicUrl: '' });

			await Storage.disk('disk-c').put('tmp/upload.txt', 'move me');
			await Storage.moveAcross('disk-c', 'tmp/upload.txt', 'disk-d', 'final/upload.txt');

			expect(await Storage.disk('disk-d').getText('final/upload.txt')).toBe('move me');
			expect(await Storage.disk('disk-c').exists('tmp/upload.txt')).toBe(false);
		} finally {
			await rm(root2, { recursive: true, force: true });
		}
	});

	it('LocalDriver works end-to-end via StorageManager', async () => {
		const { Storage } = await import('../src/index');
		Storage.addDisk('local', { driver: 'local', root, publicUrl: 'http://localhost/storage' });

		await Storage.put('hello.txt', 'world');
		expect(await Storage.getText('hello.txt')).toBe('world');
		expect(await Storage.exists('hello.txt')).toBe(true);
		await Storage.delete('hello.txt');
		expect(await Storage.exists('hello.txt')).toBe(false);
	});
});
