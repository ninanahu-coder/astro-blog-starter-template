// 第 48 轮：游戏内更新日志的数据和已读记录
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHANGELOG, CHANGELOG_LATEST } from '../../src/game/data/changelog.ts';
import { parseNewsSeen, unseenNews } from '../../src/game/ui/news.ts';

test('更新日志数据：批次号从新到旧严格递减、日期格式对、每条至少一项、不太长', () => {
	assert.equal(CHANGELOG_LATEST, CHANGELOG[0].v);
	for (let i = 1; i < CHANGELOG.length; i++) assert.ok(CHANGELOG[i].v < CHANGELOG[i - 1].v, `第 ${i} 条批次号`);
	for (let i = 1; i < CHANGELOG.length; i++) assert.ok(CHANGELOG[i].date <= CHANGELOG[i - 1].date, `第 ${i} 条日期顺序`);
	for (const e of CHANGELOG) {
		assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
		assert.ok(e.title.length > 0 && e.items.length > 0, `批次 ${e.v}`);
		for (const x of e.items) assert.ok([...x].length <= 90, `批次 ${e.v}：${x}`);
	}
});

test('已读记录：只认 0 到最新批次号之间的整数，其余当没看过；没看过几批就数几批', () => {
	assert.equal(parseNewsSeen(null), 0);
	assert.equal(parseNewsSeen(String(CHANGELOG_LATEST)), CHANGELOG_LATEST);
	for (const bad of ['abc', '-1', '3.5', String(CHANGELOG_LATEST + 1), '1e9', '', ' ']) assert.equal(parseNewsSeen(bad), 0, JSON.stringify(bad));
	assert.equal(unseenNews(CHANGELOG_LATEST), 0);
	assert.equal(unseenNews(0), CHANGELOG.length);
	assert.equal(unseenNews(CHANGELOG_LATEST - 1), 1);
});

test('声望显示格式（平衡分析第九轮复核）：整数不带 .0，半点显示 .5，浮点误差不露出来', async () => {
	const { fmtHalf } = await import('../../src/game/ui/numfmt.ts');
	assert.equal(fmtHalf(1), '1');
	assert.equal(fmtHalf(0.5), '0.5');
	assert.equal(fmtHalf(12.5), '12.5');
	assert.equal(fmtHalf(0.1 + 0.2), '0.3');
	assert.equal(fmtHalf(1.0000001), '1');
	assert.equal(fmtHalf(0), '0');
});
