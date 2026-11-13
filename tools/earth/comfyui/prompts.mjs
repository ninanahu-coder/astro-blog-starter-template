// 由游戏数据生成 CGI 提示词：每个地点一张主视觉，每个事件一张插图。
// 统一画风写在 STYLE 里，改一处全局生效。
import { EVENTS } from '../../../src/game/data/events.ts';
import { WA } from '../../../src/game/data/wa.ts';

export const STYLE = 'cinematic CGI game key art, stylized realism, warm golden light, wide shot, highly detailed, no text, no watermark';
export const NEGATIVE = 'text, watermark, logo, signature, lowres, blurry, deformed, extra limbs, real person likeness';

const KIND_HINT = {
	city: 'modern riverside city skyline', port: 'historic harbour town with limestone buildings', island: 'small car-free island with turquoise bays',
	coast: 'remote white sand coastline and turquoise ocean', outback: 'vast red-earth outback under a huge sky', mining: 'outback mining town, red dust, heavy machinery',
	park: 'national park wilderness landscape', town: 'quiet regional coastal town',
};

// 事件插图的英文画面描述（提示词用英文效果更稳）；没写的事件用标题兜底
const EVENT_SCENE = {
	'quokka-selfie': 'a smiling quokka looking up at the camera on a sunny island path',
	'whale-shark': 'a snorkeller swimming beside a giant whale shark in clear blue water, seen from below',
	'gold-nugget': 'a hand holding a small gold nugget above red dirt, old mine headframe in the background',
	'staircase-moon': 'full moon rising over tidal mudflats, reflections forming a staircase of light',
	'dolphin-visit': 'wild bottlenose dolphins in knee-deep clear shallows at sunrise',
	'flat-tyre': 'a dusty car with a flat tyre on an empty red dirt road, jack and spare wheel',
	'roo-dusk': 'a kangaroo leaping across an outback highway at sunset, seen through a windscreen',
	'gorge-pool': 'an emerald pool at the bottom of a red banded-iron gorge',
};

export function buildJobs() {
	const jobs = WA.locations.map((l) => ({
		key: l.id,
		file: `${l.id}.png`,
		prompt: `${l.en}, Western Australia, ${KIND_HINT[l.kind]}, ${l.tags.join(', ')}, ${STYLE}`,
	}));
	for (const e of EVENTS) {
		const scene = EVENT_SCENE[e.id];
		if (!scene) continue;
		jobs.push({ key: `event:${e.id}`, file: `event-${e.id}.png`, prompt: `${scene}, Western Australia, ${STYLE}` });
	}
	return jobs;
}
