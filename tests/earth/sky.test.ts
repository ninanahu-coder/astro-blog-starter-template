// 天象（第 8 批）：游戏日期对应现实日期、气温、日出日落、潮汐、山火、紫外线。全部是公式，只做显示
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { realDateLabel, realDayOfYear, temps } from '../../src/game/core/sky.ts';
import { SEASON_DAYS, YEAR_DAYS } from '../../src/game/core/time.ts';
import { WA } from '../../src/game/data/wa.ts';

const loc = (id: string) => WA.locations.find((l) => l.id === id)!;
/** 游戏第 day 天（从 0 起）的 hour 点 */
const at = (day: number, hour = 12) => day * 1440 + hour * 60;

test('日期：游戏四季对应南半球的现实月份，季内按比例，一年走一圈不倒退', () => {
	assert.equal(realDateLabel(realDayOfYear(at(0))), '9 月 2 日', '春季第 1 天 ≈ 9 月初');
	assert.equal(realDateLabel(realDayOfYear(at(SEASON_DAYS))), '12 月 2 日', '夏季第 1 天 ≈ 12 月初');
	assert.equal(realDateLabel(realDayOfYear(at(2 * SEASON_DAYS))), '3 月 2 日');
	assert.equal(realDateLabel(realDayOfYear(at(3 * SEASON_DAYS))), '6 月 2 日');
	assert.match(realDateLabel(realDayOfYear(at(YEAR_DAYS - 1))), /^8 月 (2\d|3\d) 日$/, '冬季最后一天 ≈ 8 月底');
	assert.equal(realDayOfYear(at(YEAR_DAYS + 5)), realDayOfYear(at(5)), '第二年同一天一样');
	// 同一天里时间不影响日期；一年里日期只在跨年时回绕一次
	assert.equal(realDayOfYear(at(10, 0)), realDayOfYear(at(10, 23)));
	let wraps = 0;
	for (let d = 1; d < YEAR_DAYS; d++) if (realDayOfYear(at(d)) < realDayOfYear(at(d - 1))) wraps++;
	assert.equal(wraps, 1);
	assert.equal(realDateLabel(0), '1 月 1 日');
	assert.equal(realDateLabel(364), '12 月 31 日');
	assert.equal(realDateLabel(-1), '12 月 31 日');
});

test('气温（第 36 轮）：北边暖、南边凉；夏天比冬天热；内陆温差大；炎热天更热；整数、可复现', () => {
	const jan = at(SEASON_DAYS + 14); // 夏季中 ≈ 1 月中
	const jul = at(3 * SEASON_DAYS + 14); // 冬季中 ≈ 7 月中
	for (const l of WA.locations) {
		const s = temps(l, jan, 'sunny');
		const w = temps(l, jul, 'sunny');
		assert.ok(Number.isInteger(s.max) && Number.isInteger(s.min), l.id);
		assert.ok(s.max > w.max, `${l.id} 夏天比冬天热`);
		assert.ok(s.min < s.max, l.id);
		assert.ok(s.max >= 20 && s.max <= 42 && w.max >= 12 && w.max <= 34, `${l.id} ${s.max}/${w.max} 在西澳合理范围`);
		assert.deepEqual(temps(l, jan, 'sunny'), s, '同一天同一地点一样');
	}
	assert.ok(temps(loc('broome'), jul, 'sunny').max > temps(loc('albany'), jul, 'sunny').max + 8, '冬天北边比南边暖得多');
	const k = temps(loc('kalgoorlie'), jan, 'sunny');
	const p = temps(loc('perth'), jan, 'sunny');
	assert.ok(k.max - k.min > p.max - p.min, '内陆早晚温差比海边大');
	assert.ok(temps(loc('perth'), jan, 'hot').max > p.max + 3, '炎热天更热');
	assert.ok(temps(loc('perth'), jan, 'storm').max < p.max, '风暴天凉');
	// 每天有点起伏：一季里不全是同一个数
	const days = new Set(Array.from({ length: SEASON_DAYS }, (_, d) => temps(loc('perth'), at(SEASON_DAYS + d), 'sunny').max));
	assert.ok(days.size >= 3);
});
