import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDriver } from '../src/drivers/local';
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
		delete: mock(async () => { calls.push('delete'); }),
		exists: mock(async () => { calls.push('exists'); return true; }),
		url: mock(() => { calls.push('url'); return 'http://example.com/file'; }),
		temporaryUrl: mock(async () => { calls.push('temporaryUrl'); return 'http://example.com/signed'; }),
		files: mock(async () => { calls.push('files'); return []; }),
		makeDirectory: mock(async () => { calls.push('makeDirectory'); })
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
		) as typeof fetch;

		const path = await Storage.putFromUrl('https://example.com/report.txt', 'downloads');
		expect(path).toMatch(/^downloads\/.+\.txt$/);
		expect(await Storage.getText(path)).toBe('fetched content');

		globalThis.fetch = originalFetch;
	});

	it('putFromUrl throws on non-200 response', async () => {
		const { Storage } = await import('../src/index');

		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async () => new Response(null, { status: 404 })) as typeof fetch;

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
		) as typeof fetch;

		const path = await Storage.putFromUrl('https://example.com/file.txt', 'downloads', 'custom');
		expect(path).toBe('downloads/custom.txt');

		globalThis.fetch = originalFetch;
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
