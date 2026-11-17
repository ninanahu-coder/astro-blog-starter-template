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
};
