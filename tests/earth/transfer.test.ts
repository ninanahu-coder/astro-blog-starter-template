// 换设备（第 32 轮）：同步码解析、二维码链接、扫码打开时的处理、二维码画成 SVG
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeOf, hashAction, makeQr, parseSyncCode, qrSvg, readSyncHash, syncLink } from '../../src/game/ui/transfer.ts';

const c = { id: 'player_01', key: 'a'.repeat(24) };

test('同步码：本身、整条链接都能解析，格式不对返回 null', () => {
	assert.deepEqual(parseSyncCode(`  ${codeOf(c)} `), c);
	assert.deepEqual(parseSyncCode(syncLink('https://x.test/', c)), c, '扫码得到的链接也认');
	for (const bad of ['', 'abc', 'player_01.short', `${c.id}.${c.key}x!`, `<b>.${c.key}`, null, 42, 'https://x.test/earth/#sync=nope', 'https://x.test/earth/#other=1']) assert.equal(parseSyncCode(bad), null, String(bad));
});

test('地址栏：只认 #sync=合法同步码，坏的编码不抛错', () => {
	assert.equal(readSyncHash(`#sync=${codeOf(c)}`), codeOf(c));
	assert.equal(readSyncHash(`#sync=${encodeURIComponent(codeOf(c))}`), codeOf(c));
	for (const bad of ['', '#', '#sync=', '#sync=%E0%A4%A', `#sync=${codeOf(c)}&x=1`, `?sync=${codeOf(c)}`, undefined]) assert.equal(readSyncHash(bad), null, String(bad));
});

test('二维码链接：本页地址 + #sync=，同步码在 # 后面（不发给服务器）', () => {
	assert.equal(syncLink('https://g.test', c), `https://g.test/earth/#sync=${codeOf(c)}`);
	assert.equal(syncLink('https://g.test//', c), `https://g.test/earth/#sync=${codeOf(c)}`);
	const u = new URL(syncLink('https://g.test', c));
	assert.ok(!u.search && u.hash.includes(c.key), '同步码不在查询串里');
});

test('扫码打开：没有角色就恢复，同一个角色不动，别的角色先问', () => {
	assert.equal(hashAction(null, c), 'restore');
	assert.equal(hashAction(c, { ...c }), 'same');
	assert.equal(hashAction({ id: 'other_99', key: c.key }, c), 'ask');
});

test('二维码：真的生成矩阵，SVG 留白边、白底黑格、有读屏名字且转义', async () => {
	const qr = await makeQr(syncLink('https://g.test', c));
	const n = qr.getModuleCount();
	assert.ok(n >= 21 && (n - 17) % 4 === 0, `二维码边长 ${n} 不合规格`);
	// 三个定位角是深色
	for (const [r, col] of [[0, 0], [0, n - 1], [n - 1, 0]]) assert.equal(qr.isDark(r, col), true);
	const svg = qrSvg(qr, '同步码 <二维码>');
	assert.match(svg, new RegExp(`viewBox="0 0 ${n + 8} ${n + 8}"`));
	assert.match(svg, /role="img" aria-label="同步码 &lt;二维码&gt;"/);
	assert.match(svg, /fill="#fff"/);
	assert.match(svg, /M4 4h1v1h-1z/, '左上角从第 4 格开始（4 格白边）');
	// 深色格数和矩阵一致
	let dark = 0;
	for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) dark++;
	assert.equal(svg.match(/h1v1h-1z/g)!.length, dark);
});
