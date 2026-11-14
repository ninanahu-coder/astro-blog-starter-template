// 数据导入器的校验规则（tools/earth/openclaw/checks.mjs）。只导入校验函数，不会触发导入流程、不写任何文件。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { locateInRegion } from '../../src/game/core/geo.ts';
import { WA } from '../../src/game/data/wa.ts';
import venuesData from '../../src/game/data/wa.venues.json' with { type: 'json' };
import poisData from '../../src/game/data/wa.pois.json' with { type: 'json' };
import { checkPoi, checkVenue, dedupeVenues } from '../../tools/earth/openclaw/checks.mjs';

const fre = WA.locations.find((l) => l.id === 'fremantle')!;
const venue = (over = {}) => ({ id: 'osm-node-1', loc: 'fremantle', name: '测试咖啡馆', lat: fre.lat, lon: fre.lon, type: 'cafe', source: 'osm', ...over });
const poi = (over = {}) => ({ id: 'test-poi', loc: 'fremantle', name: '测试打卡点', lat: fre.lat, lon: fre.lon, category: 'landmark', source: 'seed', ...over });

test('导入器：地点归属必须和运行时判定一致（半径重叠时按最近的地点）', () => {
	assert.equal(checkVenue(venue()), null);
	assert.equal(checkPoi(poi()), null);
	// 弗里曼特尔市中心在珀斯的半径内，但运行时归弗里曼特尔：标成珀斯要拒绝
	assert.equal(locateInRegion(WA, fre.lat, fre.lon)?.id, 'fremantle');
	assert.match(checkVenue(venue({ loc: 'perth' })) ?? '', /更近/);
	assert.match(checkPoi(poi({ loc: 'perth' })) ?? '', /更近/);
	// 原有规则仍然生效
	assert.match(checkVenue(venue({ lat: fre.lat + 360 })) ?? '', /经纬度/);
	assert.match(checkPoi(poi({ lat: fre.lat + 360 })) ?? '', /经纬度/);
	assert.match(checkVenue(venue({ loc: 'atlantis' })) ?? '', /未知地点/);
	assert.match(checkPoi(poi({ source: 'blog' })) ?? '', /source/);
});

test('导入器：仓库里现有的地点和打卡点全部通过校验', () => {
	const venues = (venuesData as { venues: unknown[] }).venues;
	const pois = (poisData as { pois: unknown[] }).pois;
	for (const v of venues) assert.equal(checkVenue(v), null, JSON.stringify(v));
	for (const p of pois) assert.equal(checkPoi(p), null, JSON.stringify(p));
	assert.ok(venues.length >= 647 && pois.length >= 8);
	assert.deepEqual(dedupeVenues(venues).dropped, [], '仓库里的地点没有重复记录');
});

test('导入器：同一场所的重复记录只留一条，不同的场所不误并', () => {
	const a = venue({ id: 'osm-node-2', name: 'Prime Radiology', type: 'clinic' });
	const sameSpot = { ...a, id: 'osm-node-1' };
	const outline = { ...a, id: 'osm-way-9', name: ' prime  radiology ', lat: a.lat + 0.00003 }; // 约 3 米，名字只差大小写和空格
	const otherType = { ...a, id: 'osm-node-3', type: 'cafe' };
	const branch = { ...a, id: 'osm-node-4', lat: a.lat + 0.003 }; // 约 330 米外的同名分店
	const otherName = { ...a, id: 'osm-node-5', name: 'Prime Dental' };
	const input = [a, sameSpot, outline, otherType, branch, otherName];
	const { kept, dropped } = dedupeVenues(input);
	assert.deepEqual(kept.map((v: { id: string }) => v.id), ['osm-node-1', 'osm-node-3', 'osm-node-4', 'osm-node-5'], '每组留 id 靠前的');
	assert.deepEqual(dropped.map((d: { venue: { id: string }; keep: string }) => [d.venue.id, d.keep]), [['osm-node-2', 'osm-node-1'], ['osm-way-9', 'osm-node-1']]);
	assert.equal(input.length, 6, '不修改入参');
});
