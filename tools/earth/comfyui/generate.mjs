#!/usr/bin/env node
// 调用远程 ComfyUI 批量生成 CGI 素材，写入 public/earth/cgi/ 并更新 manifest.json。
//
//   COMFYUI_URL=http://<远程主机>:8188 COMFYUI_CKPT=sd_xl_base_1.0.safetensors npm run earth:cgi
//
// 可选：COMFYUI_TOKEN（反向代理的 Bearer 令牌）、--only=perth,event:whale-shark、--force（覆盖已有）、--dry-run（只打印提示词）。
// 换模型/画风：替换 workflow.sdxl.json（ComfyUI 里“Save (API Format)”导出），保留 __POSITIVE__/__NEGATIVE__/__CKPT__ 占位符。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJobs, NEGATIVE } from './prompts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '../../../public/earth/cgi');
const manifestPath = join(outDir, 'manifest.json');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');

let jobs = buildJobs();
if (only) jobs = jobs.filter((j) => only.includes(j.key));

if (flag('dry-run')) {
	for (const j of jobs) console.log(`${j.key}\n  ${j.prompt}\n`);
	console.log(`${jobs.length} 个任务（dry-run，未连接 ComfyUI）。`);
	process.exit(0);
}

const base = (process.env.COMFYUI_URL || '').replace(/\/+$/, '');
if (!base) {
	console.error('请设置 COMFYUI_URL，例如 http://10.0.0.5:8188');
	process.exit(1);
}
const ckpt = process.env.COMFYUI_CKPT || 'sd_xl_base_1.0.safetensors';
const headers = process.env.COMFYUI_TOKEN ? { Authorization: `Bearer ${process.env.COMFYUI_TOKEN}` } : {};
const template = readFileSync(join(here, 'workflow.sdxl.json'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 把占位符替换成 JSON 安全的字符串，并给采样器一个由 key 决定的固定种子（可复现） */
function buildWorkflow(job) {
	const q = (s) => JSON.stringify(s).slice(1, -1);
	const wf = JSON.parse(template.replace('__POSITIVE__', q(job.prompt)).replace('__NEGATIVE__', q(NEGATIVE)).replace('__CKPT__', q(ckpt)));
	let seed = 0;
	for (const ch of job.key) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
	for (const node of Object.values(wf)) if (node.class_type === 'KSampler') node.inputs.seed = seed;
	return wf;
}

async function generate(job) {
	const res = await fetch(`${base}/prompt`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify({ prompt: buildWorkflow(job), client_id: 'terra-life' }),
	});
	if (!res.ok) throw new Error(`/prompt ${res.status}: ${(await res.text()).slice(0, 300)}`);
	const { prompt_id } = await res.json();
	for (let i = 0; i < 300; i++) {
		await sleep(2000);
		const h = await fetch(`${base}/history/${prompt_id}`, { headers });
		if (!h.ok) continue;
		const entry = (await h.json())[prompt_id];
		if (!entry) continue; // 还在排队/生成
		if (entry.status?.status_str === 'error') throw new Error('ComfyUI 执行出错: ' + JSON.stringify(entry.status.messages ?? '').slice(0, 300));
		const img = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? [])[0];
		if (!img) throw new Error('工作流没有输出图片');
		const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' });
		const file = await fetch(`${base}/view?${q}`, { headers });
		if (!file.ok) throw new Error(`/view ${file.status}`);
		return Buffer.from(await file.arrayBuffer());
	}
	throw new Error('等待超时（10 分钟）');
}

mkdirSync(outDir, { recursive: true });
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { images: {} };
manifest.images ??= {};
let done = 0, failed = 0;
for (const job of jobs) {
	const dest = join(outDir, job.file);
	if (existsSync(dest) && !flag('force')) {
		manifest.images[job.key] = `/earth/cgi/${job.file}`;
		continue;
	}
	process.stdout.write(`生成 ${job.key} … `);
	try {
		writeFileSync(dest, await generate(job));
		manifest.images[job.key] = `/earth/cgi/${job.file}`;
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n'); // 每张落盘一次，中断可续跑
		done++;
		console.log('完成');
	} catch (e) {
		failed++;
		console.log('失败：' + e.message);
	}
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\n新生成 ${done} 张，失败 ${failed} 张，manifest 共 ${Object.keys(manifest.images).length} 项。`);
process.exit(failed ? 1 : 0);
