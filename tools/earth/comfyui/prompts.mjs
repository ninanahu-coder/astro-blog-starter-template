// 由游戏数据生成 CGI 提示词：每个地点一张主视觉，每个事件一张插图。
// 统一画风写在 STYLE 里，改一处全局生效。ComfyUI（generate.mjs）和 GPT image 2（generate-gpti.mjs）共用。
import { EVENTS } from '../../../src/game/data/events.ts';
import { AREAS } from '../../../src/game/data/areas-base.ts';
import { SA_EVENTS } from '../../../src/game/data/events-sa.ts';
import { VENUE_EVENTS } from '../../../src/game/data/venue-events.ts';
import { EXPERIENCES } from '../../../src/game/data/experiences.ts';
import { PHOTO_QUESTS } from '../../../src/game/data/photo-quests.ts';
import { FESTIVALS } from '../../../src/game/data/festivals.ts';
import { VEHICLES } from '../../../src/game/data/vehicles.ts';
import { PROPERTIES } from '../../../src/game/data/properties.ts';
import { HOMES } from '../../../src/game/data/housing.ts';
import { CAREERS } from '../../../src/game/data/careers.ts';
import { COURSES } from '../../../src/game/data/courses.ts';
import { CERTS } from '../../../src/game/data/certs.ts';
import { FISH } from '../../../src/game/data/fish.ts';
import { NPCS } from '../../../src/game/data/npcs.ts';
import { TRAIL_EVENTS } from '../../../src/game/data/trail-events.ts';

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

// 事件插图的英文画面描述（提示词用英文效果更稳）；没写的事件不出图，前端用场景插画兜底。
// 有人的画面一律写背影、剪影、手部或远景，不出正脸；警察、店铺不画徽章和招牌字
const EVENT_SCENE = {
	// 西澳
	'quokka-selfie': 'a smiling quokka looking up at the camera on a sunny island path',
	'whale-shark': 'a snorkeller swimming beside a giant whale shark in clear blue water, seen from below',
	'gold-nugget': 'a hand holding a small gold nugget above red dirt, old mine headframe in the background',
	'staircase-moon': 'full moon rising over tidal mudflats, reflections forming a staircase of light',
	'pinnacles-dusk': 'limestone pillars casting long shadows across golden sand at dusk, an emu standing among them',
	'lucky-bay-roos': 'kangaroos lazing on dazzling white sand beside clear turquoise water',
	'albany-whales': 'a humpback whale mother and calf passing a harbour mouth, spray glittering in the sun',
	'natures-window': 'morning light streaming through a red sandstone rock arch over a winding river gorge',
	'spider-walk': 'a hiker seen from behind bracing hands and feet against both walls of a narrow red rock gorge above running water',
	'beehive-domes': 'aerial view from a small plane window over orange and black striped beehive-shaped sandstone domes',
	'wave-rock-top': 'looking up at a giant curved granite rock wave, a small distant figure waving from the top',
	'rain-shelter': 'heavy rain pouring off a country shop verandah, a few people seen from behind sheltering under it',
	'rainbow': 'a complete double rainbow arching over wet open country after a passing shower',
	'dolphin-visit': 'wild bottlenose dolphins in knee-deep clear shallows at sunrise',
	'super-pit-blast': 'a dust cloud rising from a blast deep inside a vast terraced open-cut gold mine, seen from a lookout',
	'flat-tyre': 'a dusty car with a flat tyre on an empty red dirt road, jack and spare wheel',
	'breakdown-overheat': 'steam pouring from under the open bonnet of a car stopped on a hot outback roadside',
	'breakdown-battery': 'a parked car with its bonnet up at a quiet country fuel station, jumper cables on the ground',
	'breakdown-belt': 'a car pulled over on a gravel shoulder, close view of a snapped engine fan belt under the bonnet',
	// 保险出险事件（还没出图，清单暂借相近的旧图，见 docs/earth-game/insurance.md §5）
	'ins-rear-end': 'two cars stopped nose to tail at a suburban traffic light after a minor rear-end bump, crumpled bumper, no number plates or lettering',
	'ins-car-breakin': 'a parked hatchback at night under a street light, driver side window smashed, glass glittering on the seat, no number plates',
	'ins-hail': 'large hailstones bouncing off the bonnet of a parked car under a dark green storm sky, no number plates',
	'ins-burglary': 'a rented apartment room in disarray, drawers pulled out and a forced door lock, seen from the doorway',
	'ins-roof-leak': 'rain water dripping from a stained ceiling into buckets in a small rented bedroom during a storm',
	'ins-lost-bag': 'an empty luggage carousel going round in a terminal arrivals hall, a traveller seen from behind waiting with a trolley',
	'roo-dusk': 'a kangaroo leaping across an outback highway at sunset, seen through a windscreen',
	'rbt': 'a roadside random breath test checkpoint at dusk, a police car with flashing blue and red lights and cones, no badges or lettering',
	'speed-late': 'a dashboard view of an open highway with a roadside speed sign and a speed camera box on a pole, daylight, no readable numbers or lettering',
	'parking-limit': 'a parked hatchback in a city street time-limited parking bay with a parking sign and a ticket under the wiper, no readable lettering',
	'hitchhiker': 'a backpacker seen from behind with thumb out at a junction on the edge of a country town',
	'busker-duet': 'a street violinist seen from the side playing on a sunny street corner, open instrument case on the ground',
	'shark-alarm': 'a lifeguard tower with a raised red flag, swimmers hurrying out of the surf onto the beach',
	'wildflowers': 'a country road through endless carpets of pink and yellow everlasting wildflowers to the horizon',
	'flies': 'a swarm of bush flies buzzing around a wide-brimmed hat in hot red outback scrub',
	'gorge-pool': 'an emerald pool at the bottom of a red banded-iron gorge',
	'pearl-offer': 'a lustrous strand of south sea pearls held out in a shadowy back lane of a small tropical pearling town, low tin-roofed buildings, only hands visible',
	'heatwave': 'heat haze shimmering over an empty bitumen road in scorching outback sun',
	'winter-swell': 'grey-white storm waves smashing against a harbour breakwater under dark winter clouds',
	'heat-check': 'two police officers seen from behind standing on a quiet town footpath, no badges or lettering, tense mood',
	'dawn-boats': 'fishing boats coming into a jetty at dawn surrounded by seagulls',
	'dusk-sunset': 'the sun sinking into the ocean, the whole beach glowing orange',
	'night-roos': 'a mob of kangaroos caught in car headlights on a dark country highway at night',
	'night-lights': 'city lights on both banks of a wide river at night with long reflections on the water',
	'freo-doctor': 'a cool afternoon sea breeze sweeping into a heritage port street, awnings and flags fluttering',
	'mandurah-crabs': 'people seen from behind wading in an estuary with scoop nets and floating tubs, hunting blue swimmer crabs',
	'bunbury-dolphins': 'bottlenose dolphins swimming close around people standing still in waist-deep bay shallows',
	'busselton-jetty-walk': 'a very long white timber jetty stretching into turquoise water, an underwater observatory at its far end',
	'margaret-cellar': 'a winery cellar door terrace with wine glasses, vineyard rows climbing the hills behind',
	'pemberton-karri': 'towering karri trees rising straight into mist, peeling bark, damp quiet forest',
	'geraldton-leaning-trees': 'old wind-bent trees leaning almost flat along the ground in open farmland',
	'hedland-ore-train': 'an endless iron ore train rolling into a port across red earth',
	'coral-bay-snorkel': 'parrotfish feeding on coral in clear knee-deep water just off a white beach',
	'monkey-mia-feeding': 'a ranger seen from behind standing in shallows while wild dolphins swim up to the beach in the morning',
	'night-milky-way': 'the Milky Way arching from horizon to horizon over dark outback with no lights',
	'night-pub-quiz': 'a cosy country pub interior at night, tables with quiz answer sheets and pens, patrons seen from behind',
	'night-turtles': 'a sea turtle crawling up a moonlit beach at night to nest',
	'night-shift-change': 'a brightly lit roadhouse at night, miners in hi-vis seen from behind queueing for hot food, red dust on their boots',
	'night-squid-jetty': 'people seen from behind fishing for squid off a lit jetty at night, glowing lures in the water',
	'night-hostel-kitchen': 'a backpacker hostel kitchen late at night, pots of noodles on the stove and a paper map on the table',
	// 店铺和场所里的通用事件
	'v-regular-nod': 'a cosy neighbourhood cafe counter in morning light, a barista seen from behind preparing a flat white',
	'v-wrong-order': 'two different plates of food on neighbouring cafe tables, one clearly the wrong dish',
	'v-cafe-laptop': 'a laptop on a cafe table beside a power point near the floor, charger cable dangling',
	'v-food-challenge': 'an enormous oversized burger and fries platter on a diner table, a stopwatch beside it',
	'v-pub-quiz': 'a lively pub on quiz night, a table with answer sheets and an empty chair, patrons seen from behind',
	'v-pub-shout': 'a round of beers being set down on a pub bar counter, hands reaching for the glasses',
	'v-gym-spot': 'a bench press rack in a weights room, a lifter seen from above the bar struggling on the last rep',
	'v-gym-trial': 'an empty weights room floor with a personal trainer seen from behind holding a clipboard',
	'v-pickup-game': 'a pickup basketball game on an outdoor court, players seen from behind waiting for one more player',
	'v-pool-lane': 'a crowded slow lane next to an empty fast lane in an outdoor public swimming pool',
	'v-pool-lifeguard': 'a lifeguard seen from behind pointing at the deep end of a public pool',
	'v-park-magpie': 'an Australian magpie swooping down through spring gum trees in a park',
	'v-park-dog': 'a friendly dog trailing its lead running across park grass',
	'v-park-bootcamp': 'a free outdoor bootcamp class on park grass, people seen from behind doing exercises',
	'v-library-group': 'library study tables with open books and flashcards, students seen from behind',
	'v-library-talk': 'a community library hall set up for a talk, rows of chairs and a projector screen',
	'v-market-markdown': 'a supermarket deli shelf with bright yellow markdown stickers on packaged food',
	'v-market-sausage': 'a community sausage sizzle stall with a barbecue and sausages in bread outside a shop',
	'v-clinic-wait': 'a quiet GP clinic waiting room, an elderly person seen from behind holding a clipboard form',
	'v-clinic-checkup': 'a doctor\'s consulting room with a blood pressure cuff on the desk',
	// 南澳
	'central-market': 'a bustling covered food market with cheese, bread and fruit stalls, shoppers seen from behind',
	'glenelg-tram': 'a modern tram arriving at its seaside terminus beside a beach and a long jetty',
	// 第 32 批出行事件：暂借相近的已有图（清单指向 glenelg-tram / hedland-ore-train / busselton-jetty-walk），按提示词重新生成后替换
	'transit-hometown': 'inside a quiet suburban commuter train carriage, two university students with backpacks chatting across the aisle, river glinting through the window',
	'rail-wheatbelt': 'view from a regional passenger train window over endless golden wheat fields and a pale salt lake under a wide sky',
	'walk-blister': 'a lone walker in sneakers sitting on a roadside kerb taping a blistered heel, a long empty suburban footpath behind',
	// 第 43 批：旅行回来的事件（插图暂借已有图，以下提示词待重新出图）
	'trip-biosecurity': 'an international arrivals hall with baggage carousels, a beagle detector dog sitting beside an open suitcase of packaged food',
	'trip-mailbox': 'a letterbox stuffed with envelopes and flyers at the front gate of a suburban house, a wheeled suitcase beside it',
	'trip-jetlag-night': 'a dark bedroom at 3 am, a phone screen glowing on the pillow, an unpacked suitcase on the floor',
	'hahndorf-bakery': 'a nineteenth-century German stone village street with a bakery displaying pretzels and sausages',
	'barossa-vintage': 'the open door of an old stone wine cellar with oak barrels, gnarled old vines outside',
	'mclaren-coast': 'vineyards rolling downhill to coastal cliffs and a sandy beach',
	'horse-tram': 'a big draught horse pulling a double-decker tram along a causeway towards a granite island',
	'heysen-start': 'a wooden walking trail marker post beside a ferry jetty, a ferry docking at a rugged headland',
	'remarkable-rocks': 'huge wind-hollowed granite boulders with orange lichen on a headland, sea lions on a beach in the distance',
	'tuna-port': 'a harbour crowded with tuna fishing boats, circular sea cage pens out in the bay',
	'opal-noodling': 'pale mullock heaps of opal mining tailings in desert hills, a hand sifting rocks with a flash of opal colour',
	'wilpena-wallaby': 'a yellow-footed rock wallaby with a ringed yellow and black tail crouching in a rock crevice',
	'blue-lake': 'a vivid cobalt blue lake inside a volcanic crater ringed by cliffs',
	'ceduna-oysters': 'freshly shucked oysters on ice at a small jetty-side shack, oyster leases on a calm bay',
	// 主要路线（实地路线）的事件（v22）：珀斯、弗里曼特尔、阿德莱德的路线共用，只写普通城市街景
	'trail-quay-start': 'a phone with a walking map held up at the start of a city riverside promenade, morning light',
	'trail-library-seat': 'an empty seat by a big window in a quiet modern public library reading room',
	'trail-asian-grocer': 'shelves of colourful Asian sauces, noodles and snacks in a small city grocery store',
	'trail-notice-board': 'a cork notice board crowded with handwritten flyers and tear-off phone number strips',
	'trail-prison-gate': 'tall pale limestone walls and a heavy old gatehouse of a nineteenth-century prison on a hill',
	'trail-city-view': 'a hilltop lookout over a modern city skyline beside a wide blue river, gum trees in the foreground',
	'trail-along-busker': 'a street guitarist seen from the side on a sunny pedestrian mall, open guitar case with coins',
	'trail-along-crossing': 'a pedestrian crossing at a city intersection, people seen from behind waiting for the green signal',
	'trail-along-sea-breeze': 'gum tree leaves and shop awnings blowing in a cool afternoon breeze on a quiet street',
	'trail-along-stairs': 'a long steep flight of outdoor stairs climbing a bushland hillside, a jogger seen from behind',
};

// 南澳事件写 South Australia，其余西澳。店铺通用事件两州都会触发：只写普通郊区，并点名不要地标（只写 Australia 时画出了悉尼歌剧院、海港大桥和乌鲁鲁）
const SA_IDS = new Set(SA_EVENTS.map((e) => e.id));
const VENUE_IDS = new Set(VENUE_EVENTS.map((e) => e.id));
const TRAIL_IDS = new Set(TRAIL_EVENTS.map((e) => e.id));
const eventPlace = (id) => (SA_IDS.has(id) ? 'South Australia' : VENUE_IDS.has(id) ? 'an ordinary Australian suburb, no famous landmarks, bridges, opera house or monoliths in view' : TRAIL_IDS.has(id) ? 'an ordinary Australian city centre, no famous landmarks, bridges, opera house or monoliths in view' : 'Western Australia');

// NPC 头像：半身像，背景是他们的常驻地点。都是虚构角色：写「原创、不像任何真人或名人」，不写族裔，只写年龄、职业和穿着。
// 画面方形，页面上只显示 56px，压成 256 宽
export const PORTRAIT_STYLE = 'head and shoulders portrait of a fictional original character, not resembling any real person or celebrity, friendly expression looking at the viewer, face centred, stylized realism CGI game character portrait, soft warm light, softly blurred background, no text, no logos, no watermark';
const NPC_LOOK = {
	mia: 'a woman around thirty, barista apron over a black t-shirt, hair tied up, busy city cafe with an espresso machine behind her',
	jack: 'a weathered old fisherman around seventy, white stubble, wool beanie and faded work shirt, fishing harbour with old boats behind him',
	linda: 'a woman in her forties, park ranger in a khaki uniform shirt and wide-brimmed hat, island scrub and turquoise bay behind her',
	leo: 'a sun-tanned man around thirty with salty wavy hair, rash vest, surf beach with breaking waves behind him',
	nan: 'a warm woman in her sixties, cardigan, holding a teapot, cosy seaside guesthouse porch behind her',
	bill: 'a burly miner in his fifties, orange hi-vis work shirt with red dust on it, old outback hotel bar behind him',
	sam: 'a man in his thirties, dive guide in a zipped-up black wetsuit with a dive mask pushed up on his forehead, turquoise reef water behind him',
	dave: 'a road train truck driver in his fifties, cap and flannel shirt, long truck cab lit up at night behind him',
	yuki: 'a Japanese-Australian woman in her forties, elegant linen shirt, small pearl earrings, tropical pearl shop behind her',
	tom: 'a rock lobster boat captain in his fifties, oilskin jacket, sun-creased face, fishing port at dawn behind him',
	harry: 'a retired lighthouse keeper around seventy, grey beard, navy knitted jumper, harbour museum with a ship model behind him',
	ruby: 'a woman around thirty, gorge guide in a sun shirt and cap, red banded rock gorge behind her',
	rosa: 'a cheerful grandmother in her late sixties, volunteer polo shirt and sun visor, calm bay shallows behind her',
	mack: 'a mango farmer in his fifties, broad-brimmed hat and work shirt, rows of mango trees and an irrigation channel behind him',
	greta: 'a winemaker woman around forty, rolled-up sleeves, holding a glass of red wine, old stone winery and vineyard behind her',
	kev: 'an opal miner in his fifties, dusty singlet and miner helmet with a lamp, pale underground dugout walls behind him',
	ayla: 'a woman around thirty, wildlife ranger in a green uniform shirt, wild coastal headland with sea lions on the beach behind her',
};

// ── 界面配图（设计清单见 docs/earth-game/cg-screens.md）──
// 小图（行内缩略图、图鉴格子）：方形构图、一个主体、背景简单，页面上只显示 48–56px，压成 256 宽
export const THUMB_STYLE = 'cinematic CGI game art, stylized realism, warm golden light, square composition, one clear subject centred and filling most of the frame, simple uncluttered background, reads clearly as a small thumbnail, highly detailed, no text, no lettering on signs, no logos, no watermark, no identifiable people';
// 不分州的通用画面（职业、住处、课程、证书……）：写普通郊区并点名不要地标
const GENERIC_PLACE = 'an ordinary Australian setting, no famous landmarks, bridges, opera house or monoliths in view';
const LOC_AREA = new Map(AREAS.flatMap((a) => a.locations.map((l) => [l.id, REGION_EN[a.id] ?? 'Western Australia'])));
const placeOf = (locId) => LOC_AREA.get(locId) ?? 'Western Australia';

// 收费体验：今天页「体验」卡每行左边的缩略图，也用在成长页的收藏册（exp:<id>）
const EXP_SCENE = {
	'rottnest-cycle': 'a bicycle parked on a coastal path above a small turquoise bay on a low scrubby island',
	'prison-night': 'a torch beam lighting a dark nineteenth-century limestone prison corridor lined with heavy cell doors',
	'swan-cruise': 'the open deck of a river cruise boat at sunset facing a glowing city skyline across wide water',
	'margaret-dinner': 'a long dinner table set with wine glasses among vineyard rows at golden hour',
	'albany-whales': 'a humpback whale breaching right beside a small whale watching boat',
	'lucky-bay': 'a dusty four-wheel-drive parked on dazzling white sand with kangaroos lazing beside turquoise water',
	'pinnacles-stars': 'the Milky Way glowing above limestone pillars in a desert at night',
	'kalbarri-skywalk': 'a cantilevered steel skywalk platform jutting out over a deep red sandstone river gorge',
	'monkey-mia-feed': 'a hand offering a small fish to a wild dolphin in clear knee-deep water',
	'super-pit-tour': 'a giant mining haul truck on the terraced floor of a vast open-cut gold mine',
	'wave-rock-dawn': 'first dawn light creeping over the crest of a giant curved granite rock wave',
	'whale-shark-swim': 'a snorkeller in a full-length wetsuit seen from behind swimming beside a giant spotted whale shark in blue water',
	'karijini-canyon': 'a person in a long-sleeve rash vest and board shorts seen from behind leaping into an emerald pool at the bottom of a red banded-rock gorge',
	'broome-camels': 'a line of camels silhouetted on a wide beach against a huge orange sunset',
	'bungle-flight': 'view from a small plane window over orange and black striped beehive-shaped sandstone domes',
	'fest-wildflower-walk': 'a narrow walking trail through carpets of pink and yellow wildflowers on a red gorge rim',
	'fest-race-day': 'racehorses thundering past a country racecourse grandstand, spectators in fancy hats seen from behind',
	'fest-skyshow': 'fireworks bursting over a wide river at night, picnic blankets on the grassy bank in the foreground',
	'fest-surf-final': 'a surfer in a full wetsuit riding a huge glassy wave below a clifftop lined with spectators seen from behind',
	'fest-long-table': 'a long communal table on a winery lawn laden with local dishes at sunset',
	'fest-street-show': 'a street performer seen from behind juggling flaming torches high above a heritage street crowd',
	'fest-ocean-cinema': 'an outdoor cinema screen on a beach at dusk showing an underwater scene of a whale shark, the sea behind it, beanbags on the sand',
	'fest-whale-watch': 'an old timber whaling station lookout above a calm bay with a whale spout in the distance',
	'fest-lantern-walk': 'a paper lantern parade with a dragon dance through an old tin-roofed town street at night, people seen from behind',
};

// 摄影任务：今天页「摄影任务」卡顶上的目标画面（photo:<id>），宽图
const PHOTO_SCENE = {
	'swan-dusk': 'pink and orange sunset clouds reflected on a wide calm river with a city skyline and black swans',
	'freo-dawn': 'small fishing boats motoring out of a heritage port harbour at dawn, seagulls overhead',
	'quokka-sun': 'a quokka basking in warm sunshine on a sandy island path, low scrub around it',
	'jetty-rain': 'a very long white timber jetty stretching into a grey sea on a rainy day, raindrops dimpling the water',
	'pinnacles-stars': 'the Milky Way arching above thousands of limestone pillars in a desert at night',
	'wave-noon': 'harsh midday sun on a giant curved granite rock wave under a deep blue sky',
	'coral-blue': 'crystal clear turquoise water over coral heads right off a white beach, seen from above',
	'cable-sunset': 'a camel train walking along a beach in front of a setting sun, long reflections on wet sand',
};

// 节日：节日卡顶上的封面（fest:<id>），宽图
const FEST_SCENE = {
	wildflower: 'a small town flower market with red gorge cliffs covered in wildflowers behind it',
	'goldfields-cup': 'racegoers in hats seen from behind at a dusty country racecourse, horses racing down the straight',
	skyshow: 'crowds on a riverbank seen from behind watching a huge fireworks show over a city at night',
	'surf-pro': 'a surfing contest on a big reef break, white marquees and spectators on the clifftop seen from behind',
	'pearl-festival': 'dragon boats on a tropical bay at dusk and a lantern-lit night market on the shore',
	'gourmet-escape': 'chefs\' hands plating rock lobster at long tables on a winery lawn',
	'street-arts': 'stilt walkers and jugglers performing in a heritage street packed with spectators seen from behind',
	'whale-shark': 'a dive boat on a turquoise reef with the huge shadow of a whale shark beneath it, a small beach town at dusk',
	'whale-season': 'whale watching boats in a wide bay as humpback whales spout, people at a seaside lookout seen from behind',
};

// 车行和「档案」里的车（veh:<id>），方形
const VEH_SCENE = {
	motorbike: 'a road motorbike parked on the shoulder of a coastal highway',
	car: 'a modest used family hatchback parked on a quiet suburban street',
	'4wd': 'a dusty four-wheel-drive with a roof rack on a corrugated red dirt track',
	campervan: 'a white pop-top campervan parked under gum trees at a quiet campsite',
};

// 可买的房产（prop:<id>），方形；房产在哪个州按 loc 写
const PROP_SCENE = {
	'kal-cottage': 'an old tin-roofed miner\'s cottage with a front verandah, distant lights of an open-cut mine at dusk',
	'perth-apartment': 'a small city apartment balcony overlooking a wide river and skyline',
	'freo-terrace': 'a row of century-old limestone terrace houses on a heritage port street',
	'margaret-townhouse': 'a modest two-storey townhouse just behind the main street of Margaret River, with a small rear courtyard and surf gear drying on a clothesline',
	'margaret-beach-house': 'a timber beach house with a deck behind coastal dunes, a surf break beyond',
	'adelaide-villa': 'a bluestone cottage with cast iron lace on its front verandah on a leafy old street',
	'glenelg-unit': 'a low seaside apartment block beside a beach and a long jetty at sunset',
	'coober-dugout': 'the entrance of an underground dugout home cut into a pale desert hillside, a ventilation pipe poking out on top',
};

// 租住的住处（home:<id>），方形
const HOME_SCENE = {
	room: 'a small tidy share-house bedroom with a single bed, a desk and a backpack on the floor',
	flat: 'a compact modern one-bedroom apartment interior with a small kitchen and a sofa in afternoon light',
	beach: 'a small weatherboard beach shack with a verandah just above the sand, ocean beyond',
	campground: 'a caravan park powered site with a campervan, a barbecue and gum trees at dusk',
	seaview: 'a high-rise apartment balcony looking out over the ocean',
	dugout: 'the inside of an underground home carved into pale sandstone, arched rooms lit by warm lamps',
};

// 职业（career:<id>），方形；有人只写背影或手
const CAREER_SCENE = {
	barista: 'a barista\'s hands pouring latte art into a cup beside a chrome espresso machine',
	lifeguard: 'a red and yellow surf rescue board and flags on a sunny beach, a lifesaver seen from behind watching the waves',
	guide: 'a tour guide in a wide-brimmed hat seen from behind leading a small group along a red rock trail',
	miner: 'a hard hat with a head lamp and an orange hi-vis vest resting on a crate above vast open-cut mine terraces',
	trucker: 'a long road train truck pulling three trailers along an empty outback highway',
	bartender: 'a bartender\'s hands pulling a beer from a tap at a timber pub counter',
	farmhand: 'a farmhand seen from behind driving a tractor through golden wheat paddocks',
	builder: 'a tradie in a hard hat and hi-vis vest seen from behind carrying timber frames across a suburban house building site',
	carer: 'a carer\'s hands holding an elderly resident\'s hand beside a cup of tea in a bright aged care lounge',
	'it-support': 'a help desk worker seen from behind fixing a laptop at a tidy office desk with two monitors and cables',
};

// 课程（course:<id>），方形
const COURSE_SCENE = {
	'driving-school': 'a learner driver\'s view over a steering wheel onto a quiet suburban road, an instructor\'s hand pointing ahead',
	'surf-school': 'soft foam surfboards lined up on the sand, beginners in long-sleeve rash vests seen from behind practising standing up',
	'personal-trainer': 'kettlebells and dumbbells on a rubber floor, a trainer seen from behind holding a clipboard',
	'run-club': 'a group of runners seen from behind on a riverside path at sunrise',
	networking: 'an evening workshop room with small round tables, coffee cups and people seen from behind chatting',
	bushcraft: 'a local guide\'s hand pointing at native bush plants in red sandy scrub, a compass in the other hand',
	negotiation: 'two pairs of hands across a table over a blank notepad and a calculator, mid deal',
};

// 职业证书（cert:<id>），方形
const CERT_SCENE = {
	rsa: 'a hand politely pushing a glass of beer back across a pub counter',
	'barista-cert': 'a perfect rosetta latte art in a cup on a saucer next to a steel milk jug',
	'bronze-medallion': 'a lifesaver in a long-sleeve rash vest and swim cap seen from behind swimming a rescue tube out through the surf',
	'wilderness-first-aid': 'an open first aid kit with a splint and bandages on a rock in the bush',
	'mine-induction': 'safety boots, a hard hat, ear muffs and a hi-vis vest laid out neatly on a bench, red dust',
	'hr-licence': 'side view of a heavy prime mover truck with a long trailer on an open highway',
	'tractor-ticket': 'a tractor and a forklift in a farm shed yard beside hay bales',
	'white-card': 'a blank plastic safety induction card lying on a hard hat next to steel-capped boots at a building site, no readable text',
	'first-aid': 'hands practising CPR compressions on a training manikin on a classroom floor, a first aid kit beside it',
};

// 鱼获图鉴（fish:<id>），方形；钓到前页面仍显示问号
const FISH_SCENE = {
	herring: 'an Australian herring',
	mullet: 'a sea mullet',
	whiting: 'a King George whiting',
	'black-bream': 'a black bream',
	salmon: 'an Australian salmon',
	squid: 'a southern calamari squid',
	'blue-crab': 'a blue swimmer crab',
	'pink-snapper': 'a pink snapper',
	dhufish: 'a West Australian dhufish',
	trevally: 'a golden trevally',
	mackerel: 'a Spanish mackerel',
	barramundi: 'a barramundi',
};

// 页头横幅和空状态：宽图，页面里只显示一条（object-fit: cover）
const BANNER_SCENE = {
	grow: 'an open travel journal with blank pages, loose photo prints, a compass and a pressed wildflower on a timber table',
	social: 'a group of friends seen from behind sharing a beach barbecue at sunset',
	near: 'an ordinary suburban main street with cafes and small shops in morning light, shopfronts without any signage',
};
const EMPTY_SCENE = {
	bag: 'an empty canvas backpack lying open on timber floorboards in soft light',
	rels: 'two empty chairs facing each other on a sunny timber verandah',
	estate: 'an empty grassy suburban block at sunset with a single gum tree and a garden gate',
};

/** 界面配图任务：键名前缀 → 场景表；square 的出 1024×1024 并压成 256 宽，其余 1536×1024 */
function screenJobs() {
	const jobs = [];
	const square = (key, file, scene, place) => jobs.push({ key, file, prompt: `${scene}, ${place}, ${THUMB_STYLE}`, size: '1024x1024', width: 256 });
	const wide = (key, file, scene, place, width) => jobs.push({ key, file, prompt: `${scene}, ${place}, ${STYLE}`, width });
	for (const e of EXPERIENCES) if (EXP_SCENE[e.id]) square(`exp:${e.id}`, `exp-${e.id}.png`, EXP_SCENE[e.id], placeOf(e.loc));
	for (const q of PHOTO_QUESTS) if (PHOTO_SCENE[q.id]) wide(`photo:${q.id}`, `photo-${q.id}.png`, PHOTO_SCENE[q.id], placeOf(q.loc), 960);
	for (const f of FESTIVALS) if (FEST_SCENE[f.id]) wide(`fest:${f.id}`, `fest-${f.id}.png`, FEST_SCENE[f.id], placeOf(f.loc), 960);
	for (const v of VEHICLES) if (VEH_SCENE[v.id]) square(`veh:${v.id}`, `veh-${v.id}.png`, VEH_SCENE[v.id], GENERIC_PLACE);
	for (const p of PROPERTIES) if (PROP_SCENE[p.id]) square(`prop:${p.id}`, `prop-${p.id}.png`, PROP_SCENE[p.id], placeOf(p.loc));
	for (const h of HOMES) if (HOME_SCENE[h.id]) square(`home:${h.id}`, `home-${h.id}.png`, HOME_SCENE[h.id], GENERIC_PLACE);
	for (const c of CAREERS) if (CAREER_SCENE[c.id]) square(`career:${c.id}`, `career-${c.id}.png`, CAREER_SCENE[c.id], GENERIC_PLACE);
	for (const c of COURSES) if (COURSE_SCENE[c.id]) square(`course:${c.id}`, `course-${c.id}.png`, COURSE_SCENE[c.id], GENERIC_PLACE);
	for (const c of CERTS) if (CERT_SCENE[c.id]) square(`cert:${c.id}`, `cert-${c.id}.png`, CERT_SCENE[c.id], GENERIC_PLACE);
	for (const f of FISH) if (FISH_SCENE[f.id]) square(`fish:${f.id}`, `fish-${f.id}.png`, `side view of ${FISH_SCENE[f.id]} freshly caught, lying on wet timber jetty boards`, 'Western Australian coast');
	for (const [id, scene] of Object.entries(BANNER_SCENE)) wide(`banner:${id}`, `banner-${id}.png`, scene, GENERIC_PLACE, 960);
	for (const [id, scene] of Object.entries(EMPTY_SCENE)) wide(`empty:${id}`, `empty-${id}.png`, scene, GENERIC_PLACE, 640);
	return jobs;
}
/** 界面配图的类别：键名前缀、尺寸和「每项都要有图」用的数据（测试和文档共用） */
export const SCREEN_KINDS = {
	exp: { square: true, ids: Object.keys(EXP_SCENE) },
	photo: { square: false, ids: Object.keys(PHOTO_SCENE) },
	fest: { square: false, ids: Object.keys(FEST_SCENE) },
	veh: { square: true, ids: Object.keys(VEH_SCENE) },
	prop: { square: true, ids: Object.keys(PROP_SCENE) },
	home: { square: true, ids: Object.keys(HOME_SCENE) },
	career: { square: true, ids: Object.keys(CAREER_SCENE) },
	course: { square: true, ids: Object.keys(COURSE_SCENE) },
	cert: { square: true, ids: Object.keys(CERT_SCENE) },
	fish: { square: true, ids: Object.keys(FISH_SCENE) },
	banner: { square: false, ids: Object.keys(BANNER_SCENE) },
	empty: { square: false, ids: Object.keys(EMPTY_SCENE) },
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
		jobs.push({ key: `event:${e.id}`, file: `event-${e.id}.png`, prompt: `${scene}, ${eventPlace(e.id)}, ${STYLE}` });
	}
	jobs.push(...screenJobs());
	for (const n of NPCS) {
		const look = NPC_LOOK[n.id];
		if (!look) continue;
		jobs.push({ key: `npc:${n.id}`, file: `npc-${n.id}.png`, prompt: `${look}, ${PORTRAIT_STYLE}`, size: '1024x1024', width: 256 });
	}
	return jobs;
}
