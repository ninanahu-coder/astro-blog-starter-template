// 职业证书课：花钱花时间考一张证，之后这份职业每个班的工资按比例上涨（游戏内上班和真实打卡都算）。
// 证书跟人走，换工作、辞职都不丢；同一张证只考一次。价格、时长、加薪比例都是第 12 轮新加的，待平衡。
import type { CertDef } from '../core/types.ts';

export const CERTS: CertDef[] = [
	{ id: 'rsa', name: 'RSA 酒水服务证', career: 'bartender', price: 120, minutes: 240, payBonus: 0.15, where: { kinds: ['city', 'port', 'town'] }, hours: [9, 17], desc: '负责任地售酒：识别醉酒、拒绝售卖、查验证件。' },
	{ id: 'barista-cert', name: '咖啡师认证课', career: 'barista', price: 180, minutes: 240, payBonus: 0.15, where: { kinds: ['city', 'port'] }, hours: [8, 16], desc: '萃取、打奶、拉花，结业有证书。' },
	{ id: 'bronze-medallion', name: '铜牌救生证', career: 'lifeguard', price: 260, minutes: 360, payBonus: 0.15, where: { tags: ['beach'] }, hours: [7, 15], desc: '海上救援、心肺复苏、急救，考核在海里进行。' },
	{ id: 'wilderness-first-aid', name: '野外急救证', career: 'guide', price: 300, minutes: 480, payBonus: 0.15, where: { kinds: ['city', 'park'] }, hours: [8, 12], desc: '远离医院时怎么处理骨折、中暑、蛇咬。' },
	{ id: 'mine-induction', name: '矿山安全入职证', career: 'miner', price: 350, minutes: 480, payBonus: 0.15, where: { kinds: ['mining', 'city'] }, hours: [7, 11], desc: '矿区安全规程、个人防护、紧急撤离。' },
	{ id: 'hr-licence', name: '重型卡车驾照', career: 'trucker', price: 600, minutes: 480, payBonus: 0.15, where: { kinds: ['city', 'mining'] }, hours: [7, 11], desc: '学会开带拖挂的大货车，能接更远的单。' },
	// 第 33 批新增：既是入行门槛（careers.ts 的 req.certs），也给对口职业加薪。价格参照现实（出处见 education-career.md 第 2 节）按约 0.8 倍取整，待平衡
	{ id: 'white-card', name: 'White Card 建筑安全卡', career: 'builder', price: 35, minutes: 450, payBonus: 0.1, where: { kinds: ['city', 'town', 'mining'] }, hours: [7, 9], desc: '工地入场资格（CPCWHS1001）。' },
	{ id: 'first-aid', name: '急救证（HLTAID011）', career: 'carer', price: 145, minutes: 480, payBonus: 0.1, where: { kinds: ['city', 'town'] }, hours: [8, 10], desc: '心肺复苏、止血，护理业入行门槛。' },
	{ id: 'tractor-ticket', name: '农机操作证', career: 'farmhand', price: 220, minutes: 360, payBonus: 0.15, where: { kinds: ['outback', 'town'], tags: ['wine'] }, hours: [7, 13], desc: '拖拉机、叉车、喷药机的安全操作。' },
];
