// 地点小知识卡：每个地点 3 条真实小知识，第 1、2、3 次到访依次解锁。
// 资料由 OpenClaw 从维基百科、西澳政府和公园网站采集（2026-11-17），Claude 按来源逐条核对并改写；
// 原始采集结果见 tools/earth/openclaw/inbox/facts-2026-11-17.json。
export interface PlaceFact {
	text: string;
	source: string;
}

const W = (page: string) => `https://en.wikipedia.org/wiki/${page}`;

export const FACTS: Record<string, PlaceFact[]> = {
	perth: [
		{ text: '珀斯 1829 年由詹姆斯·斯特林建立，1856 年由维多利亚女王宣布为城市。', source: W('Perth') },
		{ text: '国王公园约 400 公顷，园里有 1600 多块纪念阵亡将士的牌子。', source: W('Kings_Park,_Western_Australia') },
		{ text: '珀斯铸币厂 1899 年开张，到 1931 年铸了超过 1 亿枚金币。', source: W('Perth_Mint') },
	],
	fremantle: [
		{ text: '弗里曼特尔的努恩加尔名叫 Walyalup，意思是「woylie（一种小型有袋动物）住的地方」。', source: W('Fremantle') },
		{ text: '弗里曼特尔监狱 1855 年启用、1991 年关闭，2010 年列入世界遗产。', source: W('Fremantle_Prison') },
		{ text: '1897 年工程师 C.Y. 奥康纳把港口挖深，这里成了淘金热时的西澳门户。', source: W('Fremantle') },
	],
	rottnest: [
		{ text: '1696 年荷兰船长弗拉明把矮袋鼠当成大老鼠，给小岛起名「老鼠窝」。', source: W('Rottnest_Island') },
		{ text: '岛上第一座灯塔 1849 年建成，是西澳第一座石头灯塔。', source: W('Wadjemup_Lighthouse') },
		{ text: '现在的瓦杰马普灯塔 1896 年启用，是澳洲第一座旋转光束灯塔。', source: W('Wadjemup_Lighthouse') },
	],
	pinnacles: [
		{ text: '石阵在南邦国家公园里，最高的石柱约有 3.5 米。', source: W('Pinnacles_Desert') },
		{ text: '石柱由古代贝壳变成的钙质沙子胶结而成，再被风雨慢慢掏空。', source: W('Pinnacles_Desert') },
		{ text: '这片沙漠 1967 年才划为保护区，2008 年建了沙漠探索中心。', source: W('Pinnacles_Desert') },
	],
	bunbury: [
		{ text: '班伯里 1836 年设镇，以探路的亨利·班伯里中尉命名。', source: W('Bunbury,_Western_Australia') },
		{ text: '班伯里是西澳人口第三多的城市，2021 年约有 7.6 万人。', source: W('Bunbury,_Western_Australia') },
		{ text: '1893 年西南铁路通到班伯里，这里成了西南地区的主要港口。', source: W('Bunbury,_Western_Australia') },
	],
	'margaret-river': [
		{ text: '玛格丽特河镇 1913 年正式设立，一战后 1922 年迎来上百户移民。', source: W('Margaret_River,_Western_Australia') },
		{ text: '世界冲浪联赛的玛格丽特河职业赛通常在每年秋天（4—5 月）在这里举行。', source: W('Margaret_River_Pro') },
		{ text: '镇南约 21 公里的猛犸洞里有超过 3.5 万年的化石，1904 年起对外开放。', source: W('Margaret_River,_Western_Australia') },
	],
	albany: [
		{ text: '奥尔巴尼 1826 年圣诞节次日建立，比珀斯早两年多，是西澳最早的英国定居点。', source: W('Albany,_Western_Australia') },
		{ text: '当地梅南族把这里叫 Kinjarling，意思是「富饶之地」「下雨的地方」。', source: W('Albany,_Western_Australia') },
		{ text: '2014 年国家澳新军团中心在这里开幕，纪念活动来了约 4 万人。', source: W('Albany,_Western_Australia') },
	],
	esperance: [
		{ text: '1792 年法国船「希望号」躲风暴驶进海湾，小镇因此得名。', source: W('Esperance,_Western_Australia') },
		{ text: '1979 年天空实验室残骸掉在镇上，镇政府罚了美国 $400 乱扔垃圾。', source: W('Esperance,_Western_Australia') },
		{ text: '那笔罚款直到 2009 年才由一位电台主持人向听众募捐付清。', source: W('Esperance,_Western_Australia') },
	],
	'wave-rock': [
		{ text: '波浪岩高约 15 米、长约 110 米，在海登镇以东约 3 公里。', source: W('Wave_Rock') },
		{ text: '组成波浪岩的花岗岩大约有 26.3 亿年历史。', source: W('Wave_Rock') },
		{ text: '1928 年岩顶修了一道挡水墙，把雨水引进水坝给附近农户用。', source: W('Wave_Rock') },
	],
	kalgoorlie: [
		{ text: '卡尔古利因 1893 年发现黄金而兴起，现在和鲍尔德合成一个市。', source: W('Kalgoorlie') },
		{ text: '1903 年，一条约 530 公里长的水管把珀斯附近蒙达林堰的水送到了这里。', source: W('Goldfields_Water_Supply_Scheme') },
		{ text: '这一带的金矿带被叫作「黄金一英里」，曾号称世界上最富的一平方英里。', source: W('Kalgoorlie') },
	],
	geraldton: [
		{ text: '豪特曼阿布罗留斯群岛在杰拉尔顿以西约 60 公里的海上。', source: W('Geraldton') },
		{ text: '圣方济各沙勿略大教堂由神父建筑师约翰·霍斯设计，1916 到 1938 年建成。', source: W('Geraldton') },
		{ text: '悉尼号巡洋舰纪念碑 2001 年落成，就在军舰沉没 60 周年的前一天。', source: W('Geraldton') },
	],
	kalbarri: [
		{ text: '卡尔巴里在默奇森河入海口，离珀斯约 590 公里。', source: W('Kalbarri,_Western_Australia') },
		{ text: '「卡尔巴里」来自当地南达族一位男子的名字，也是一种能吃的种子。', source: W('Kalbarri,_Western_Australia') },
		{ text: '国家公园里的「自然之窗」和 Z 字弯观景台都能俯瞰河谷。', source: 'https://exploreparks.dbca.wa.gov.au/park/kalbarri-national-park' },
	],
	'monkey-mia': [
		{ text: '猴子米亚在珀斯以北约 900 公里，属于鲨鱼湾世界遗产区。', source: W('Monkey_Mia') },
		{ text: '上世纪 60 年代，一对渔民夫妇开始在岸边喂宽吻海豚。', source: W('Monkey_Mia') },
		{ text: '1982 年起科学家在这里研究海豚，后来扩展到整个鲨鱼湾。', source: W('Monkey_Mia') },
	],
	exmouth: [
		{ text: '埃克斯茅斯 1964 年建镇，起初是为附近的美军通信站服务。', source: W('Exmouth,_Western_Australia') },
		{ text: '2023 年日全食时，有 2 万多人聚在埃克斯茅斯看日食。', source: W('Exmouth,_Western_Australia') },
		{ text: '镇上的「大鲸鲨」雕塑建于 2002 年，「大虾」建于 2005 年。', source: W('Exmouth,_Western_Australia') },
	],
	karijini: [
		{ text: '卡瑞吉尼国家公园 1969 年设立，1991 年改用现在的名字。', source: W('Karijini_National_Park') },
		{ text: '公园约 62.7 万公顷，是西澳第二大的国家公园。', source: W('Karijini_National_Park') },
		{ text: '峡谷岩壁里的条带状铁矿层大约有 25 亿年历史。', source: W('Karijini_National_Park') },
	],
	'port-hedland': [
		{ text: '黑德兰港以 1863 年到访的船长彼得·赫德兰命名。', source: W('Port_Hedland') },
		{ text: '1966 年第一船铁矿石从这里运往日本。', source: W('Port_Hedland') },
		{ text: '当地原住民叫它 Marapikurrinya，形容港湾的潮沟像伸开的手。', source: W('Port_Hedland') },
	],
	broome: [
		{ text: '甘塞姆角的恐龙脚印约有 1.3 亿年，只在大退潮时露出来。', source: W('Broome,_Western_Australia') },
		{ text: '布鲁姆 1883 年定名，取自当时的西澳总督弗雷德里克·布鲁姆。', source: W('Broome,_Western_Australia') },
		{ text: '1889 年海底电报电缆在这里上岸，经爪哇连到英国。', source: W('Broome,_Western_Australia') },
	],
	kununurra: [
		{ text: '库努纳拉 1961 年设镇，是为奥德河灌溉区建的。', source: W('Kununurra') },
		{ text: '奥德河分水坝 1963 年由总理孟席斯启用，设计灌溉约 750 平方公里农田。', source: W('Kununurra') },
		{ text: '阿盖尔湖被称为澳洲最大的人工湖，面积超过 100 平方公里。', source: W('Kununurra') },
	],
	mandurah: [
		{ text: '「曼杜拉」来自努恩加尔语 mandjar，意思是聚会、交易的地方。', source: W('Mandurah') },
		{ text: '皮尔—哈维河口约 134 平方公里，大约是悉尼港的两倍。', source: W('Mandurah') },
		{ text: '这里住着西澳已知最大的宽吻海豚群，估计约 120 只。', source: W('Mandurah') },
	],
	busselton: [
		{ text: '巴瑟尔顿栈桥长 1841 米，是南半球最长的木栈桥。', source: W('Busselton') },
		{ text: '栈桥 1864 年开建，一直加长到 1960 年代才有现在的长度。', source: W('Busselton') },
		{ text: '2003 年起，栈桥尽头开放了水下观测站。', source: W('Busselton') },
	],
	pemberton: [
		{ text: '格洛斯特树高 61 米，1947 年被林务员选作防火瞭望树。', source: W('Gloucester_Tree') },
		{ text: '它是 1937 到 1952 年间西南部建起的 8 棵瞭望树之一。', source: W('Gloucester_Tree') },
		{ text: '2026 年 7 月重新开放后，游客最高只能爬到 37 米的新观景台。', source: W('Gloucester_Tree') },
	],
	'coral-bay': [
		{ text: '珊瑚湾的礁石一直长到水边，浮潜不用坐船就能看珊瑚。', source: W('Coral_Bay,_Western_Australia') },
		{ text: '宁格鲁礁沿海岸绵延 300 多公里，海洋公园里有 200 多种珊瑚。', source: W('Coral_Bay,_Western_Australia') },
		{ text: '每年 6 月到 10 月，这里有出海观鲸的船。', source: W('Coral_Bay,_Western_Australia') },
	],
	// ---------- 南澳（第 42 轮）：OpenClaw 采集（2026-11-18，原始结果见 tools/earth/openclaw/inbox/sa-locations-2026-11-18.json），Claude 核对改写 ----------
	adelaide: [
		{ text: '阿德莱德城中心是威廉·莱特规划的，棋盘式街道配几座宽阔的广场。', source: W('Adelaide') },
		{ text: '一圈公园绿地环绕着城中心，这片公园已列入澳洲国家遗产名录。', source: W('Adelaide_Park_Lands') },
		{ text: '阿德莱德建于 1836 年，是一座按规划建起来的自由移民首府。', source: W('Adelaide') },
	],
	glenelg: [
		{ text: '1836 年南澳宣布建立殖民地，地点就在格莱内尔格附近的老桉树下。', source: W('Glenelg,_South_Australia') },
		{ text: '格莱内尔格被认为是南澳大陆上最早的欧洲人定居点。', source: W('Glenelg,_South_Australia') },
		{ text: '现在的格莱内尔格码头 1969 年建成。', source: W('Glenelg,_South_Australia') },
	],
	hahndorf: [
		{ text: '汉多夫是澳洲现存最古老的德国移民定居点。', source: W('Hahndorf,_South_Australia') },
		{ text: '第一批德国路德宗移民 1838 年坐「斑马号」来到这里。', source: W('Hahndorf,_South_Australia') },
		{ text: '镇上的圣米迦勒路德教堂 1839 年创立，至今还有人来做礼拜。', source: W('Hahndorf,_South_Australia') },
	],
	barossa: [
		{ text: '塔南达四周都是葡萄园，巴罗萨是澳洲最有名的葡萄酒产区之一。', source: W('Tanunda,_South_Australia') },
		{ text: '这里有 1847 年种下的设拉子葡萄藤，是世界上最老的一批之一。', source: W('Tanunda,_South_Australia') },
		{ text: '巴罗萨谷是 1840 年代英国和德国移民开垦出来的。', source: W('Barossa_Valley') },
	],
	'mclaren-vale': [
		{ text: '1923 年格洛斯特和贝尔维尤两个村合并，成了今天的麦克拉伦谷镇。', source: W('McLaren_Vale,_South_Australia') },
		{ text: '麦克拉伦谷是受保护的葡萄酒地理标志产区。', source: W('McLaren_Vale,_South_Australia') },
		{ text: '小镇离阿德莱德市中心约 35 公里。', source: W('McLaren_Vale,_South_Australia') },
	],
	'victor-harbor': [
		{ text: '1802 年英国的弗林德斯和法国的博丹在这片海湾相遇，海湾因此叫「相遇湾」。', source: W('Victor_Harbor,_South_Australia') },
		{ text: '花岗岩岛靠一条海堤连到岸上，至今还有马拉的电车来回跑。', source: W('Victor_Harbor,_South_Australia') },
		{ text: '老式蒸汽小火车「鸟蛤号」往返维克多港和古尔瓦。', source: W('Victor_Harbor,_South_Australia') },
	],
	'kangaroo-island': [
		{ text: '袋鼠岛是澳洲第三大岛，只比塔斯马尼亚和梅尔维尔岛小。', source: W('Kangaroo_Island') },
		{ text: '金斯科特旁的里夫斯角，是 1836 年南澳第一个官方殖民定居点。', source: W('Kingscote,_South_Australia') },
		{ text: '海豹湾的沙滩上躺着成群的澳洲海狮，岛上也有小企鹅。', source: W('Kangaroo_Island') },
	],
	'port-lincoln': [
		{ text: '林肯港在波士顿湾边上，海湾向东通往斯潘塞湾。', source: W('Port_Lincoln,_South_Australia') },
		{ text: '当地原住民管这里叫 Galinyala，意思是「有淡水的地方」。', source: W('Port_Lincoln,_South_Australia') },
		{ text: '近海冷水上涌，养活了金枪鱼和沙丁鱼这些重要渔获。', source: W('Port_Lincoln,_South_Australia') },
	],
	'coober-pedy': [
		{ text: '库伯佩迪号称「世界欧泊之都」，世界上大部分白欧泊产在这里。', source: W('Coober_Pedy') },
		{ text: '为了躲酷热，很多人家直接把房子凿进地下的砂岩里。', source: W('Coober_Pedy') },
		{ text: '当地原住民给这里起的名字 Umoona 意思是「长寿」。', source: W('Coober_Pedy') },
	],
	'flinders-ranges': [
		{ text: '威尔佩纳盆地是一圈山围出来的巨大天然盆地，像个环形剧场。', source: W('Wilpena_Pound') },
		{ text: '山里的伊迪卡拉山保存了地球上最早的一批动物化石。', source: W('Flinders_Ranges') },
		{ text: '圣玛丽峰海拔 1171 米，是弗林德斯山脉的最高峰。', source: W('Flinders_Ranges') },
	],
	'mount-gambier': [
		{ text: '甘比尔山城建在一座休眠火山的山坡和火山口平原上。', source: W('Mount_Gambier,_South_Australia') },
		{ text: '蓝湖是一座火山口湖，夏天湖水会从灰色变成钴蓝色。', source: W('Mount_Gambier,_South_Australia') },
		{ text: '它是南澳人口第二多的城市，离维多利亚州边界很近。', source: W('Mount_Gambier,_South_Australia') },
	],
	ceduna: [
		{ text: '锡杜纳在穆拉特湾边上，旁边是特维纳德港。', source: W('Ceduna,_South_Australia') },
		{ text: '从东往西横穿纳拉伯平原之前，这是最后一个像样的镇子。', source: W('Ceduna,_South_Australia') },
		{ text: '镇外的旧卫星天线后来改成了射电望远镜。', source: W('Ceduna,_South_Australia') },
	],
};
