// 由游戏数据生成 CGI 提示词：每个地点一张主视觉，每个事件一张插图。
// 统一画风写在 STYLE 里，改一处全局生效。ComfyUI（generate.mjs）和 GPT image 2（generate-gpti.mjs）共用。
import { EVENTS } from '../../../src/game/data/events.ts';
import { AREAS } from '../../../src/game/data/areas-base.ts';

export const STYLE = 'cinematic CGI game key art, stylized realism, warm golden light, wide landscape shot, main subject centred in the middle band of the frame, highly detailed, no text, no lettering on signs, no logos, no watermark, no identifiable people';
export const NEGATIVE = 'text, watermark, logo, signature, lowres, blurry, deformed, extra limbs, real person likeness';

// 区域的英文名，写进提示词让画面像那个州
const REGION_EN = { wa: 'Western Australia', sa: 'South Australia' };

const KIND_HINT = {
	city: 'modern city skyline', port: 'historic harbour town with old stone buildings', island: 'small island with turquoise bays',
	coast: 'remote white sand coastline and turquoise ocean', outback: 'vast red-earth outback under a huge sky', mining: 'outback mining town, red dust, heavy machinery',
	park: 'national park wilderness landscape', town: 'quiet regional country town',
};

// 地点主视觉：每个地点一句标志性风景（英文）。游戏标签里的机场、医院、健身房、酒吧是玩法用的，画进去会让画面又挤又乱（第一次试画的教训）
const LOC_SCENE = {
	perth: 'Perth city skyline and the Swan River seen from Kings Park, gum trees in the foreground',
	fremantle: 'Fremantle heritage limestone streets, old port warehouses and fishing boat harbour',
	rottnest: 'Rottnest Island turquoise bay with white sand, low scrub and a quokka on the path',
	pinnacles: 'thousands of limestone pillars rising from golden desert sand in Nambung National Park',
	bunbury: 'Koombana Bay shallows with dolphins and a calm regional seaside town',
	'margaret-river': 'rolling vineyard rows meeting coastal forest, surf breaking on the beach beyond',
	albany: 'King George Sound with granite headlands and a humpback whale breaching',
	esperance: 'Lucky Bay with dazzling white sand, turquoise water and kangaroos on the beach',
	'wave-rock': 'Wave Rock, a giant curved granite cliff shaped like a breaking wave, wheatbelt plains',
	kalgoorlie: 'Kalgoorlie goldfields heritage main street with ornate old hotels and a vast open-cut gold mine',
	geraldton: 'Geraldton foreshore and a red-and-white striped lighthouse on a windy Indian Ocean coast',
	kalbarri: 'Nature\'s Window, a red sandstone rock arch framing the Murchison River gorge',
	'monkey-mia': 'wild dolphins in knee-deep shallows on a red-dune beach in Shark Bay',
	exmouth: 'Ningaloo Reef turquoise lagoon beside red Cape Range hills and a lighthouse on the cape',
	karijini: 'deep red banded-rock gorge with a waterfall and an emerald swimming pool',
	'port-hedland': 'huge iron ore ships in a tidal harbour, red earth and long ore trains',
	broome: 'camel train walking along Cable Beach at sunset',
	kununurra: 'Kimberley ranges, boab trees and the calm waters of Lake Argyle',
	mandurah: 'Mandurah waterfront canals with boats and dolphins at dusk',
	busselton: 'the long white timber Busselton Jetty stretching into calm turquoise water',
	pemberton: 'towering karri forest with sunlight through tall pale trunks',
	'coral-bay': 'shallow coral lagoon right off a white beach with snorkellers and reef fish',
	adelaide: 'Adelaide city on the River Torrens with parklands and the hills behind',
	glenelg: 'Glenelg seaside jetty, beach and a heritage tram on the promenade',
	hahndorf: 'Hahndorf old German village main street with stone cottages and big gum trees',
	barossa: 'Barossa Valley vineyards with an old stone winery and rolling hills',
	'mclaren-vale': 'McLaren Vale vineyards rolling down towards the coast',
	'victor-harbor': 'Granite Island causeway with a horse-drawn tram crossing to the island',
	'cape-jervis': 'Cape Jervis headland and a ferry crossing Backstairs Passage to Kangaroo Island',
	'kangaroo-island': 'Remarkable Rocks, huge orange-lichen granite boulders on a wild Kangaroo Island headland',
	'port-lincoln': 'Port Lincoln marina with tuna fishing boats on Boston Bay',
	'coober-pedy': 'Coober Pedy opal fields, pale mullock heaps and dugout homes in desert hills',
	'flinders-ranges': 'Wilpena Pound red mountain ranges, river red gums and kangaroos',
	'mount-gambier': 'the vivid cobalt Blue Lake inside a volcanic crater',
	ceduna: 'Ceduna long jetty and oyster farms on a calm bay at the edge of the Nullarbor',
};

// 事件插图的英文画面描述（提示词用英文效果更稳）；没写的事件不出图，前端用场景插画兜底
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
	const jobs = [];
	for (const area of AREAS) {
		const place = REGION_EN[area.id] ?? 'Australia';
		for (const l of area.locations) {
			jobs.push({
				key: l.id,
				file: `${l.id}.png`,
				prompt: `${LOC_SCENE[l.id] ?? `${l.en}, ${KIND_HINT[l.kind]}`}, ${place}, ${STYLE}`,
			});
		}
	}
	for (const e of EVENTS) {
		const scene = EVENT_SCENE[e.id];
		if (!scene) continue;
		jobs.push({ key: `event:${e.id}`, file: `event-${e.id}.png`, prompt: `${scene}, Western Australia, ${STYLE}` });
	}
	return jobs;
}
