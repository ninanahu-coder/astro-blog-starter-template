// 签名事件：每个有签名事件的地点，第一次抵达必出，且只出一次
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction } from '../../src/game/core/actions.ts';
import { createCharacter } from '../../src/game/core/character.ts';
import { getPendingEvent } from '../../src/game/core/engine.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { WA } from '../../src/game/data/wa.ts';

test('签名事件：第一次真实定位抵达必出，选完之后不再出现', () => {
	const sig = EVENTS.filter((e) => e.once && e.locs?.length === 1);
	for (const id of ['pinnacles-dusk', 'lucky-bay-roos', 'albany-whales', 'wave-rock-top']) assert.ok(sig.some((e) => e.id === id), id);
	for (const ev of sig) {
		const loc = WA.locations.find((l) => l.id === ev.locs![0])!;
		const s = createCharacter({ id: 'sig-' + ev.id, name: '签名', avatar: '🧑', origin: 'backpacker', region: 'wa', spawn: WA.spawn, seed: 11 });
		const r = applyAction(s, WA, { t: 'gps', lat: loc.lat, lon: loc.lon });
		assert.ok(r.ok, `${ev.id}: ${r.msg}`);
		assert.equal(getPendingEvent(r.state)?.id, ev.id, `${loc.name} 第一次抵达应该出「${ev.title}」`);
		// 选最后一个（不花钱、不检定或检定失败也能结算）的选项
		const done = applyAction(r.state, WA, { t: 'event', choice: ev.choices.length - 1 });
		assert.ok(done.ok, `${ev.id}: ${done.msg}`);
		assert.ok(done.state.seen.includes(ev.id));
		assert.equal(done.state.pending, null);
	}
});
