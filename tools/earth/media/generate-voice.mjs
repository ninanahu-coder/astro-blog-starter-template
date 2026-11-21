// NPC 打招呼语音：读 voices.json，调 MiniMax T2A（海外端点 api.minimax.io），落成 64kbps 单声道 mp3，并写进 public/earth/media/manifest.json。
// 用法：MINIMAX_API_KEY=… node tools/earth/media/generate-voice.mjs [--only=mia,jack] [--force] [--dry-run]
// - 先查 Token Plan 余量：周余量低于 30% 直接停（网站聊天和这里共用同一份额度）；5 小时窗口用完报 QUOTA 退出码 4，可用 mm-quota-retry 包着续跑。
// - 已有的 mp3 默认跳过，中断可续跑。
// - 落盘前用 ffmpeg loudnorm 统一响度（-18 LUFS，峰值 -1.5 dBTP）：不同音色原始响度差了十几 dB（11-20 实测 -15 ~ -31 dB）。
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = join(ROOT, 'public/earth/media/voice');
const MANIFEST = join(ROOT, 'public/earth/media/manifest.json');
const API = 'https://api.minimax.io';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const { lines } = JSON.parse(readFileSync(new URL('voices.json', import.meta.url), 'utf8'));
const only = args.only ? new Set(String(args.only).split(',')) : null;
const jobs = lines.filter((l) => !only || only.has(l.npc));
const key = process.env.MINIMAX_API_KEY;

function loadManifest() {
	return existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { note: 'AI 生成示意内容（视频：远程 ComfyUI MiniMax H3；语音：MiniMax TTS），不是实拍、不是真人录音。', loc: {}, voice: {} };
}
function saveManifest(m) {
	const sort = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
	writeFileSync(MANIFEST, JSON.stringify({ ...m, loc: sort(m.loc), voice: sort(m.voice) }, null, '\t') + '\n');
}

if (args['dry-run']) {
	for (const l of jobs) console.log(`${l.npc}\t${l.voice}\t${l.text}`);
	process.exit(0);
}
if (!key) { console.error('缺 MINIMAX_API_KEY'); process.exit(2); }

const rem = await fetch(`${API}/v1/api/openplatform/coding_plan/remains`, { headers: { authorization: `Bearer ${key}` } }).then((r) => r.json());
const general = (rem.model_remains ?? []).find((m) => m.model_name === 'general');
if (general) {
	console.log(`Token Plan general：5 小时窗口 ${general.current_interval_remaining_percent}%，周 ${general.current_weekly_remaining_percent}%`);
	if (general.current_weekly_remaining_percent < 30) { console.error('周余量低于 30%，停下，别把网站聊天的额度用光'); process.exit(3); }
}

mkdirSync(OUT, { recursive: true });
const m = loadManifest();
let made = 0;
for (const l of jobs) {
	const file = join(OUT, `${l.npc}.mp3`);
	const url = `/earth/media/voice/${l.npc}.mp3`;
	if (existsSync(file) && !args.force) { m.voice[l.npc] = { src: url, text: l.text }; continue; }
	const res = await fetch(`${API}/v1/t2a_v2`, {
		method: 'POST',
		headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
		body: JSON.stringify({ model: 'speech-2.8-hd', text: l.text, stream: false, voice_setting: { voice_id: l.voice, speed: 1, emotion: 'happy' }, audio_setting: { format: 'mp3', sample_rate: 24000, bitrate: 64000, channel: 1 } }),
	}).then((r) => r.json());
	const code = res.base_resp?.status_code;
	if (code !== 0 || !res.data?.audio) {
		const msg = `${l.npc} 失败：${code} ${res.base_resp?.status_msg ?? ''}`;
		saveManifest(m);
		if ([1008, 2056, 1002, 429].includes(code) || /quota|limit/i.test(msg)) { console.error(msg + '（QUOTA）'); process.exit(4); }
		console.error(msg); process.exit(1);
	}
	const raw = file + '.raw.mp3';
	writeFileSync(raw, Buffer.from(res.data.audio, 'hex'));
	execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-af', 'loudnorm=I=-18:TP=-1.5:LRA=11', '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', file]);
	unlinkSync(raw);
	m.voice[l.npc] = { src: url, text: l.text };
	made++;
	console.log(`✓ ${l.npc} ${l.voice}`);
}
saveManifest(m);
console.log(`完成：新生成 ${made} 条，清单 ${Object.keys(m.voice).length} 条`);
