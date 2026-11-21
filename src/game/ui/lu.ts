// 界面图标（体验改造 P2）：引用页面里的 Lucide 雪碧图（构建时写进 HTML，见 lucide-sprite.ts）。
// 这里只 import 类型，页面脚本不会把整张雪碧图打进首屏。
import type { LucideName } from './lucide-sprite.ts';

/** 一个界面图标：装饰性，读屏跳过（旁边的文字或按钮的 aria-label 负责说明） */
export const lu = (name: LucideName, cls = '') => `<svg class="lu${cls ? ' ' + cls : ''}" aria-hidden="true" focusable="false"><use href="#lu-${name}"/></svg>`;
