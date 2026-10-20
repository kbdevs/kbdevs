// Draws this profile from profile.json in light and dark. The contribution forest and team
// totals use the past 12 months from GitHub's website calendars. Node 20+, no dependencies.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { calendar } from './calendar.mjs';

const KIT = new URL('./', import.meta.url);
const LOGIN = process.env.LOGIN;
const OUT = 'dist';
if (LOGIN == null || LOGIN === '') throw new Error('LOGIN is required');

const RAW = `https://raw.githubusercontent.com/${LOGIN}/${LOGIN}/output`;
const FONT = `'Google Sans Flex','Google Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
const THEMES = {
	dark: {
		card: '#111821',
		ink: '#eef3f6',
		line: '#ffffff',
		lineOp: 0.08,
		muted: '#9aabb6',
		snakeEdge: 0,
		soil: '#1d2632',
	},
	light: {
		card: '#fbfcfd',
		ink: '#172c33',
		line: '#172c33',
		lineOp: 0.09,
		muted: '#596a76',
		snakeEdge: 0.14,
		soil: '#e6edf1',
	},
};
const fmt = (n) => n.toLocaleString('en-US');
const esc = (s) =>
	String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
const svg = (w, h, label, body, viewBox = `0 0 ${w} ${h}`) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}" font-family="${FONT}" role="img" aria-label="${esc(label)}">${body}</svg>`.replace(/[ \t]+$/gm, '');

// ---- Data -------------------------------------------------------------------------------------

async function dataUri(url, type) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status}`);
	return `data:${type ?? res.headers.get('content-type') ?? 'image/png'};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

// Consecutive days with a contribution, ending today, or yesterday when today has none yet.
function streak(days) {
	let i = days.length - 1,
		n = 0;
	if (i >= 0 && days[i].count === 0) i--;
	for (; i >= 0 && days[i].count > 0; i--) n++;
	return n;
}

// ---- Tree snake -------------------------------------------------------------------------------

// Canopy colours by month, light to shade: winter frost, spring fresh, summer Eco green, autumn sunlight.
const FROST = ['#f4f9fc', '#cfe3ec', '#8fb3c4'],
	SPRING = ['#d4f7c4', '#93e07f', '#56b85a'],
	SUMMER = ['#a6ee9c', '#4ecc54', '#2a9a3a'];
const CANOPY = {
	1: FROST,
	2: FROST,
	3: SPRING,
	4: SPRING,
	5: ['#bff0ae', '#78d86a', '#3fae4d'],
	6: SUMMER,
	7: SUMMER,
	8: SUMMER,
	9: ['#ecf7a0', '#bcd84c', '#7fae2a'],
	10: ['#ffe08a', '#ffae19', '#e07b10'],
	11: ['#ffc59a', '#f0743a', '#c24a1e'],
	12: FROST,
};
// The snake takes on the colour of what it eats: each tree pulls its body a third of the way toward
// that tree's canopy, so it blends through the seasons as it crosses the year.
const SNAKE_LENGTH = 12;
const EAT_PULL = 0.35;
const channel = (hex, i) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
function mix(from, to, amount) {
	return `#${[0, 1, 2]
		.map((i) => Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * amount))
		.map((v) => v.toString(16).padStart(2, '0'))
		.join('')}`;
}

// One round tree per month in a 20×20 box: soft shadow, trunk, three-lobe canopy lit from the upper left.
const treeDefs = () =>
	Object.entries(CANOPY)
		.map(
			([m, [hi, base, lo]]) => `
    <radialGradient id="g${m}" gradientUnits="userSpaceOnUse" cx="7.4" cy="4.6" r="11.5"><stop offset="0" stop-color="${hi}"/><stop offset=".45" stop-color="${base}"/><stop offset="1" stop-color="${lo}"/></radialGradient>
    <symbol id="t${m}" viewBox="0 0 20 20">
      <ellipse cx="10" cy="18.6" rx="5.2" ry="1.2" fill="#0b1720" opacity=".14"/>
      <rect x="8.9" y="11" width="2.2" height="7.6" rx="1.1" fill="#b98a5e"/>
      <circle cx="6.4" cy="11" r="4.1" fill="url(#g${m})"/><circle cx="13.6" cy="11" r="4.1" fill="url(#g${m})"/><circle cx="10" cy="7.4" r="5.6" fill="url(#g${m})"/>
      <ellipse cx="8" cy="5.2" rx="2" ry="1.2" fill="#fff" opacity=".45" transform="rotate(-25 8 5.2)"/>
    </symbol>`,
		)
		.join('');

// The snake enters mid-left and always goes for the nearest tree; it eats the forest, which then regrows.
function snakeSVG({ cols, days, total }, theme) {
	const t = THEMES[theme];
	const S = 15.5,
		y0 = 20,
		H = y0 + 7 * S + 46,
		W = 880,
		x0 = (W - cols * S) / 2;
	const center = (c, r) => [x0 + c * S + S / 2, y0 + r * S + S / 2];

	const left = new Map(days.filter((d) => d.count > 0).map((d) => [`${d.col},${d.row}`, d]));
	let pos = [-1, 3];
	const steps = [[-3, 3], ...walk([-3, 3], pos)];
	const eatenAt = new Map();
	while (left.size > 0) {
		let best,
			bestDist = Infinity;
		for (const d of left.values()) {
			const dist = Math.abs(d.col - pos[0]) + Math.abs(d.row - pos[1]);
			if (dist < bestDist || (dist === bestDist && d.col < best.col)) {
				bestDist = dist;
				best = d;
			}
		}
		steps.push(...walk(pos, [best.col, best.row]));
		pos = [best.col, best.row];
		eatenAt.set(best, steps.length - 1);
		left.delete(`${best.col},${best.row}`);
	}
	steps.push(...walk(pos, [cols + 6, pos[1]]));

	const travel = 0.86,
		T = steps.length / 22 / travel;
	const at = (k) => (k / (steps.length - 1)) * travel * 100;
	const path = steps
		.map(
			([c, r], i) =>
				`${i === 0 ? 'M' : 'L'}${center(c, r)
					.map((v) => v.toFixed(1))
					.join(',')}`,
		)
		.join(' ');

	let ground = '',
		keys = '',
		trees = '';
	for (const { col, row } of days) {
		const [x, y] = center(col, row);
		ground += `<ellipse cx="${x}" cy="${y + 5}" rx="4.4" ry="2" fill="${t.soil}"/>`;
	}
	// Trees paint top row first so lower rows overlap them. Each is eaten when the head arrives,
	// then the forest regrows in a wave from left to right before the loop starts again.
	const grown = [...eatenAt.keys()].toSorted((a, b) => a.row - b.row || a.col - b.col);
	for (const d of grown) {
		const [x, y] = center(d.col, d.row),
			k = eatenAt.get(d);
		const base = y + 6.5,
			h = [0, 13, 15, 17, 19.5][d.level || 1];
		const a = at(k),
			back = 90 + (d.col / cols) * 7;
		keys += `@keyframes e${k}{0%,${a.toFixed(2)}%{transform:scale(1)}${(a + 0.5).toFixed(2)}%,${back.toFixed(2)}%{transform:scale(0)}${(back + 1.6).toFixed(2)}%{transform:scale(1.15)}${(back + 2.4).toFixed(2)}%,100%{transform:scale(1)}}`;
		trees += `<use href="#t${+d.date.slice(5, 7)}" x="${(x - h / 2).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${h}" height="${h}" style="transform-origin:${x.toFixed(1)}px ${base}px;animation:e${k} ${T.toFixed(2)}s linear infinite"/>`;
	}
	const cell = (T * travel) / (steps.length - 1);
	const edge =
		t.snakeEdge > 0 ? ` stroke="#172c33" stroke-opacity="${t.snakeEdge}" stroke-width=".8"` : '';
	let colour = SUMMER[1];
	const colours = [colour],
		colourTimes = ['0'];
	for (const [d, k] of [...eatenAt].toSorted((x, y) => x[1] - y[1])) {
		colour = mix(colour, CANOPY[+d.date.slice(5, 7)][1], EAT_PULL);
		colourTimes.push((at(k) / 100).toFixed(4));
		colours.push(colour);
	}
	colourTimes.push('1');
	colours.push(colour);
	const fill = `values="${colours.join(';')}" keyTimes="${colourTimes.join(';')}"`;
	// Each segment trails the head along the path and through its colours by the same delay.
	const snake = Array.from({ length: SNAKE_LENGTH }, (_, j) => {
		const begin = `${(j * cell * 0.55).toFixed(3)}s`;
		return `
    <circle r="${(5.6 - j * 0.22).toFixed(2)}" fill="${SUMMER[1]}"${edge}>
      <animateMotion dur="${T.toFixed(2)}s" repeatCount="indefinite" begin="${begin}" path="${path}" keyPoints="0;1;1" keyTimes="0;${travel};1" calcMode="linear"/>
      <animate attributeName="fill" dur="${T.toFixed(2)}s" repeatCount="indefinite" begin="${begin}" ${fill} calcMode="linear"/>
    </circle>`;
	})
		.toReversed()
		.join('');

	return svg(
		W,
		H,
		`${fmt(total)} contributions in the last 12 months`,
		`
    <defs>${treeDefs()}<clipPath id="field"><rect width="${W}" height="${H}" rx="16"/></clipPath></defs>
    <style>${keys}</style>
    <rect width="${W}" height="${H}" rx="16" fill="${t.card}"/>
    <g clip-path="url(#field)">${ground}${trees}${snake}</g>
    <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="15.5" fill="none" stroke="${t.line}" stroke-opacity="${t.lineOp}"/>
    <text x="${x0 + 2}" y="${H - 15}" font-size="16" fill="${t.ink}">${fmt(total)} contributions in the last 12 months</text>`,
	);
}

// Rough advance widths (em) for the fallback sans; textLength then pins the text to exactly this width.
function textWidth(text, size) {
	let em = 0;
	for (const ch of text) {
		if (ch.codePointAt(0) > 0x2000) em += 1.15;
		else if ("ijl.,:;'|!".includes(ch)) em += 0.26;
		else if ('ftrI()[]'.includes(ch)) em += 0.36;
		else if ('mwMW@'.includes(ch)) em += 0.86;
		else if (ch === ' ') em += 0.28;
		else if (ch >= 'A' && ch <= 'Z') em += 0.68;
		else em += 0.56;
	}
	return Math.ceil(em * size);
}

// ---- Pills ------------------------------------------------------------------------------------

// Grid steps from a to b: across first, then up or down, one cell at a time.
function walk([c, r], [tc, tr]) {
	const out = [];
	while (c !== tc) {
		c += Math.sign(tc - c);
		out.push([c, r]);
	}
	while (r !== tr) {
		r += Math.sign(tr - r);
		out.push([c, r]);
	}
	return out;
}

const ICONS = {
	instagram: `<g fill="none" stroke="currentColor" stroke-width="2.1"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.4"/></g><circle cx="17.6" cy="6.4" r="1.2" fill="currentColor"/>`,
	linkedin: `<path fill="currentColor" d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13Zm1.78 13.02H3.56V9h3.56v11.45ZM22.23 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z"/>`,
	x: `<path fill="currentColor" d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.59-6.64 7.59H.47l8.6-9.83L0 1.15h7.59l5.25 6.93ZM17.61 20.64h2.04L6.49 3.24H4.3Z"/>`,
};
const SOCIALS = {
	instagram: { label: 'Instagram', text: (h) => `@${h}`, url: (h) => `https://instagram.com/${h}` },
	linkedin: { label: 'LinkedIn', text: (h) => h, url: (h) => `https://linkedin.com/in/${h}` },
	x: { label: 'X', text: (h) => `@${h}`, url: (h) => `https://x.com/${h}` },
};

function pill(theme, lead, text, label, weight = 550) {
	const H = 36,
		t = THEMES[theme],
		tw = textWidth(text, 14),
		W = 12 + 16 + 8 + tw + 15;
	return svg(
		W,
		H,
		label,
		`
    <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="17.5" fill="${t.card}" stroke="${t.line}" stroke-opacity="${t.lineOp}"/>
    <g transform="translate(12 10)" color="${t.ink}">${lead}</g>
    <text x="36" y="23" font-size="14" font-weight="${weight}" fill="${t.ink}" textLength="${tw}" lengthAdjust="spacing">${esc(text)}</text>`,
	);
}
const socialPill = (theme, key, handle) =>
	pill(
		theme,
		`<svg width="16" height="16" viewBox="0 0 24 24">${ICONS[key]}</svg>`,
		SOCIALS[key].text(handle),
		`${SOCIALS[key].label} ${SOCIALS[key].text(handle)}`,
	);
const applyPill = (theme) =>
	pill(
		theme,
		`<circle cx="8" cy="8" r="8" fill="#ffae19" opacity=".22"/><circle cx="8" cy="8" r="4" fill="#ffae19"/>`,
		'Apply to join the Eco team  →',
		'Apply to join the Eco team',
		600,
	);

// ---- The team's solar system ------------------------------------------------------------------

// Dark is deep space; light is the same system lit by day. Drawn as one scene, cut into one slice
// per member so each planet links to its owner.
const SCENE = { cy: 92, H: 248, sunX: -84, W: 880 };
const SKY = {
	dark: {
		blue: 0.28,
		card: '#ffffff',
		cardLine: '#ffffff',
		cardLineOp: 0.12,
		cardOp: 0.07,
		chip: '#ffffff',
		chipOp: 0.1,
		glow: 0.35,
		green: 0.14,
		halo: '#9fd0ff',
		haloOp: 0.18,
		label: 0.55,
		orbit: '#fff',
		orbitOp: 0.2,
		space: ['#0b1330', '#070b1d', '#050816'],
		star: '#fff',
		starMax: 0.7,
		sub: '#c9d6e3',
		text: '#fff',
	},
	light: {
		blue: 0.16,
		card: '#ffffff',
		cardLine: '#172c33',
		cardLineOp: 0.08,
		cardOp: 0.78,
		chip: '#172c33',
		chipOp: 0.06,
		glow: 0.45,
		green: 0.1,
		halo: '#ffffff',
		haloOp: 0.7,
		label: 0.5,
		orbit: '#172c33',
		orbitOp: 0.18,
		space: ['#fff6e2', '#f3f8fd', '#e6f1fc'],
		star: '#1e88fd',
		starMax: 0.35,
		sub: '#3d4f5a',
		text: '#172c33',
	},
};
const LIFT = [-12, 12, -10, 10, -12];
const CARD_GAP = 50,
	CARD_H = 44;

// A small glass card under each planet, as wide as its contents: face, name, last year's
// contributions and the current streak. It rides the planet's height, so the row staggers.
function memberCard(m, k, isMe) {
	const chipW = (text) => textWidth(text, 10) + 12;
	const fire = `🔥 ${m.streak}`,
		total = fmt(m.total),
		w1 = chipW(total),
		w2 = chipW(fire);
	const w = 42 + Math.max(textWidth(m.name, 12.5), w1 + 4 + w2) + 10,
		x = m.x - w / 2,
		y = m.y + CARD_GAP;
	const chip = (
		cx,
		cw,
		text,
	) => `<rect x="${cx}" y="${y + 25}" width="${cw}" height="14" rx="7" fill="${k.chip}" fill-opacity="${k.chipOp}"/>
      <text x="${cx + 6}" y="${y + 35.5}" font-size="10" font-weight="600" fill="${k.sub}" textLength="${cw - 12}" lengthAdjust="spacing">${text}</text>`;
	return `
      <clipPath id="face"><circle cx="${x + 23}" cy="${y + 22}" r="13"/></clipPath>
      <rect x="${x}" y="${y}" width="${w}" height="${CARD_H}" rx="12" fill="${k.card}" fill-opacity="${k.cardOp}" stroke="${k.cardLine}" stroke-opacity="${k.cardLineOp}"/>
      <image href="${m.avatarUri}" x="${x + 10}" y="${y + 9}" width="26" height="26" clip-path="url(#face)"/>
      <text x="${x + 42}" y="${y + 18}" font-size="12.5" font-weight="${isMe ? 700 : 600}" fill="${k.text}">${esc(m.name)}</text>
      ${chip(x + 42, w1, total)}${chip(x + 42 + w1 + 4, w2, fire)}`;
}

function rng(seed) {
	return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

function teamSlice(team, i, theme) {
	const k = SKY[theme],
		{ cy, H, sunX, W } = SCENE,
		tile = W / team.length,
		x0 = tile * i,
		x1 = x0 + tile;
	const placed = team.map((m, j) => {
		const x = tile * j + tile / 2,
			y = cy + LIFT[j % LIFT.length];
		return { ...m, R: Math.hypot(x - sunX, y - cy), x, y };
	});
	const r = rng(7);
	let stars = '';
	for (let s = 0; s < 140; s++) {
		const delay = -r() * 5,
			op = 0.25 + r() * k.starMax,
			size = 0.35 + r() * 0.95,
			twinkles = r() < 0.22,
			x = r() * W,
			y = r() * H;
		if (x < x0 - 3 || x > x1 + 3) continue;
		stars += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size.toFixed(2)}" fill="${k.star}" opacity="${op.toFixed(2)}"${twinkles ? ` class="tw" style="animation-delay:${delay.toFixed(2)}s"` : ''}/>`;
	}
	const orbits = placed
		.map(
			({ R }) =>
				`<circle cx="${sunX}" cy="${cy}" r="${R.toFixed(1)}" fill="none" stroke="${k.orbit}" stroke-opacity="${k.orbitOp}" stroke-dasharray="1.5 6"/>`,
		)
		.join('');
	const m = placed[i],
		isMe = m.login === LOGIN;
	const [w, h] = m.planet === 'saturn' ? [108, 70] : [74, 74];
	const sun =
		i === 0
			? `<circle class="pulse" cx="${sunX}" cy="${cy}" r="260" fill="url(#glow)"/><circle cx="${sunX}" cy="${cy}" r="132" fill="url(#sun)"/>`
			: '';
	const label =
		i === team.length - 1
			? `<text x="${W - 24}" y="${H - 12}" text-anchor="end" font-size="10" font-weight="650" letter-spacing="2" fill="${k.text}" fill-opacity="${k.label}">THE ECO TEAM</text>`
			: '';
	return svg(
		tile,
		H,
		m.name,
		`
    <defs>
      <linearGradient id="space" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${k.space[0]}"/><stop offset=".55" stop-color="${k.space[1]}"/><stop offset="1" stop-color="${k.space[2]}"/></linearGradient>
      <radialGradient id="nebulaB" gradientUnits="userSpaceOnUse" cx="${W * 0.7}" cy="${H * 0.1}" r="${W * 0.45}"><stop offset="0" stop-color="#1e88fd" stop-opacity="${k.blue}"/><stop offset="1" stop-color="#1e88fd" stop-opacity="0"/></radialGradient>
      <radialGradient id="nebulaG" gradientUnits="userSpaceOnUse" cx="${W * 0.42}" cy="${H * 1.05}" r="${W * 0.4}"><stop offset="0" stop-color="#4ecc54" stop-opacity="${k.green}"/><stop offset="1" stop-color="#4ecc54" stop-opacity="0"/></radialGradient>
      <radialGradient id="sun"><stop offset="0" stop-color="#fffaf0"/><stop offset=".35" stop-color="#ffd27a"/><stop offset=".7" stop-color="#ffae19"/><stop offset="1" stop-color="#ffae19" stop-opacity="0"/></radialGradient>
      <radialGradient id="glow"><stop offset="0" stop-color="#ffae19" stop-opacity="${k.glow}"/><stop offset="1" stop-color="#ffae19" stop-opacity="0"/></radialGradient>
      <radialGradient id="halo"><stop offset=".55" stop-color="${k.halo}" stop-opacity="${k.haloOp}"/><stop offset="1" stop-color="${k.halo}" stop-opacity="0"/></radialGradient>
      <clipPath id="card"><rect width="${W}" height="${H}" rx="16"/></clipPath>
    </defs>
    <style>
      .float { animation: float 7s ease-in-out infinite; }
      @keyframes float { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
      .tw { animation: tw 3.4s ease-in-out infinite; }
      @keyframes tw { 0%, 100% { opacity: .15 } 50% { opacity: 1 } }
      .pulse { animation: pulse 6s ease-in-out infinite; transform-origin: ${sunX}px ${cy}px; }
      @keyframes pulse { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.05) } }
    </style>
    <g clip-path="url(#card)">
      <rect width="${W}" height="${H}" fill="url(#space)"/><rect width="${W}" height="${H}" fill="url(#nebulaB)"/><rect width="${W}" height="${H}" fill="url(#nebulaG)"/>
      ${stars}${sun}${orbits}${label}
      <g class="float" style="animation-delay:${-i * 1.4}s">
        <circle cx="${m.x}" cy="${m.y}" r="${h * 0.62}" fill="url(#halo)"/>
        <image href="${m.planetUri}" x="${m.x - w / 2}" y="${m.y - h / 2}" width="${w}" height="${h}"/>
      </g>
      ${memberCard(m, k, isMe)}
    </g>
    <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="15.5" fill="none" stroke="${THEMES[theme].line}" stroke-opacity="${THEMES[theme].lineOp}"/>`,
		`${x0} 0 ${tile} ${H}`,
	);
}

// ---- README -----------------------------------------------------------------------------------

const picture = (name, alt, attrs) => {
	// A new image URL makes GitHub's image proxy fetch this render instead of its cached count.
	const url = (theme) => {
		const path = `${name}-${theme}.svg`;
		const version = createHash('sha256').update(files[`${OUT}/${path}`]).digest('hex').slice(0, 16);
		return `${RAW}/${path}?v=${version}`;
	};
	return `<picture><source media="(prefers-color-scheme: dark)" srcset="${url('dark')}"><img alt="${esc(alt)}" src="${url('light')}" ${attrs}></picture>`;
};
const linked = (href, inner) => `<a href="${esc(href)}">${inner}</a>`;

// Socials, then the forest, then who you are, then the team. GitHub allows no styles in a README,
// so body text sits in <small> a step below the default size, under an h2.
function readme(profile, team, socials) {
	const lines = [
		`<!-- Generated by .eco/render.mjs from profile.json. Edit profile.json, not this file. -->`,
		'',
	];
	if (socials.length > 0) {
		lines.push(
			`<p>${socials.map(([key, handle]) => linked(SOCIALS[key].url(handle), picture(`social-${key}`, `${SOCIALS[key].label} ${SOCIALS[key].text(handle)}`, `height="32"`))).join('\n')}</p>`,
			'',
		);
	}
	lines.push(`<p>${picture('snake', 'Contribution forest', `width="100%"`)}</p>`, '');
	if (profile.name) lines.push(`## Hey, I'm ${profile.name} 👋`, '');
	for (const p of profile.intro ?? []) lines.push(`<small>${p}</small>`, '');
	for (const [title, items] of Object.entries(profile.sections ?? {})) {
		if (items.length === 0) continue;
		lines.push(`#### ${title}`, '', ...items.map((item) => `- <small>${item}</small>`), '');
	}
	lines.push(`<br>`, '');
	lines.push(
		`<p>${linked('https://ecogpt.com/careers', picture('apply', 'Apply to join the Eco team', `height="32"`))}</p>`,
		'',
	);
	// One line, no whitespace between slices, so they sit edge to edge as one scene.
	lines.push(
		`<p>${team.map((m, i) => linked(`https://github.com/${m.login}`, picture(`team-${i + 1}`, m.name, `width="${100 / team.length}%"`))).join('')}</p>`,
		'',
	);
	return lines.join('\n');
}

// ---- Main -------------------------------------------------------------------------------------

const profile = JSON.parse(await readFile('profile.json', 'utf8'));
const team = JSON.parse(await readFile(new URL('team.json', KIT), 'utf8'));
const socials = Object.entries(profile.socials ?? {}).filter(
	([key, handle]) => key in SOCIALS && handle !== '',
);
const cal = await calendar(LOGIN);
await Promise.all(
	team.map(async (m) => {
		const [planet, avatarUri, rolling] = await Promise.all([
			readFile(new URL(`planets/${m.planet}.png`, KIT)),
			dataUri(`https://github.com/${m.login}.png?size=64`),
			m.login === LOGIN ? cal : calendar(m.login),
		]);
		Object.assign(m, {
			avatarUri,
			planetUri: `data:image/png;base64,${planet.toString('base64')}`,
			streak: streak(rolling.days),
			total: rolling.total,
		});
	}),
);

const files = {};
for (const theme of ['light', 'dark']) {
	files[`${OUT}/snake-${theme}.svg`] = snakeSVG(cal, theme);
	files[`${OUT}/apply-${theme}.svg`] = applyPill(theme);
	for (const [key, handle] of socials)
		files[`${OUT}/social-${key}-${theme}.svg`] = socialPill(theme, key, handle);
	team.forEach((_, i) => (files[`${OUT}/team-${i + 1}-${theme}.svg`] = teamSlice(team, i, theme)));
}
files['README.md'] = readme(profile, team, socials);
await mkdir(OUT, { recursive: true });
await Promise.all(Object.entries(files).map(([path, body]) => writeFile(path, body)));
console.info(
	`Rendered ${LOGIN}: ${fmt(cal.total)} contributions (${cal.from} to ${cal.to}), ${team.length} teammates, ${socials.length} socials.`,
);
