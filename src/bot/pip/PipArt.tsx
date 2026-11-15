/**
 * Pip's artwork: the inline SVG of `design/pip-mascot-sandbox.html`, as JSX.
 *
 * The drawing is kept exactly as designed (view box 0 0 380 380). Only the wiring changed:
 * - ids used for styling became classes (`#head-group` is `.pip-head-group`), so several
 *   mascots can share a page; `pip.css` selects them under the root `.pip-bot`,
 * - ids that must stay ids (gradients, the screen clip path) come in through `ids`, unique
 *   per mascot,
 * - text uses the app's own display font instead of a web font.
 *
 * Five layers, back to front: background props, body, head, foreground props (book, desk),
 * and the arms and hands, which are always on top so they can hold things.
 *
 * The component is rendered once per mascot and never again: the arms and hands are drawn in
 * the resting pose of the first state, and from then on `PipEngine` moves them directly.
 */
import { memo, type JSX } from 'react';
import { restingArms } from './poses';
import type { PipState } from './states';

/** The ids of one mascot's gradients and clip path. */
export interface PipArtIds {
  mintGrad: string;
  armCyanGrad: string;
  torsoGrad: string;
  goldGrad: string;
  angryGrad: string;
  purpleGrad: string;
  ambientGlow: string;
  screenClip: string;
}

const ID_NAMES = [
  'mintGrad',
  'armCyanGrad',
  'torsoGrad',
  'goldGrad',
  'angryGrad',
  'purpleGrad',
  'ambientGlow',
  'screenClip',
] as const satisfies readonly (keyof PipArtIds)[];

/** Builds the id set for one mascot from React's `useId()` value, which may hold characters that `url(#...)` dislikes. */
export function makePipArtIds(reactId: string): PipArtIds {
  const prefix = `pip-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const ids = {} as PipArtIds;
  for (const name of ID_NAMES) ids[name] = `${prefix}-${name}`;
  return ids;
}

interface PipArtProps {
  ids: PipArtIds;
  /** The state at first render: its resting arm pose is what React draws. */
  initialState: PipState;
}

function PipArtwork({ ids, initialState }: PipArtProps): JSX.Element {
  const { left, right } = restingArms(initialState);
  return (
    <>
      <defs>
        {/* Mint-Cyan Head & Limb Gradient */}
        <linearGradient id={ids.mintGrad} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#9DF8E8" />
          <stop offset="52%" stopColor="#64F5E8" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>

        {/* Segmented Arm Tube Cyan Gradient */}
        <linearGradient id={ids.armCyanGrad} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8CFBF0" />
          <stop offset="55%" stopColor="#5CE6DC" />
          <stop offset="100%" stopColor="#22B8CF" />
        </linearGradient>

        {/* Warm Yellow-to-Cyan Chest Gradient */}
        <linearGradient id={ids.torsoGrad} x1="15%" y1="0%" x2="85%" y2="100%">
          <stop offset="0%" stopColor="#FFE66D" />
          <stop offset="44%" stopColor="#7EECE0" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>

        {/* Golden Yellow Accent Gradient */}
        <linearGradient id={ids.goldGrad} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFE97D" />
          <stop offset="65%" stopColor="#FFD54F" />
          <stop offset="100%" stopColor="#FFB300" />
        </linearGradient>

        {/* Angry Screen Coral-Red Tint */}
        <linearGradient id={ids.angryGrad} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#991B1B" />
          <stop offset="100%" stopColor="#EF4444" />
        </linearGradient>

        {/* Purple Storybook & Wizard Hat Gradient */}
        <linearGradient id={ids.purpleGrad} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#A78BFA" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>

        {/* Soft Ambient Glow */}
        <radialGradient id={ids.ambientGlow} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#6EE7D8" stopOpacity="0.28" />
          <stop offset="70%" stopColor="#A78BFA" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#A78BFA" stopOpacity="0" />
        </radialGradient>

        {/* Screen Clip Path */}
        <clipPath id={ids.screenClip}>
          <rect x="108" y="88" width="164" height="106" rx="28" />
        </clipPath>
      </defs>

      {/* Ambient Circle & Ground Contact Shadow */}
      <circle className="pip-ambient" cx="190" cy="190" r="158" fill={`url(#${ids.ambientGlow})`} />
      <ellipse className="pip-bot-shadow" cx="190" cy="346" rx="64" ry="11" fill="#1E2246" opacity="0.16" />

      {/* LAYER 1: background props (chalkboard, pillow, magic, particles) */}
      <g className="pip-bg-props-layer">
        {/* Teaching Chalkboard ('★ abc') positioned clearly on right */}
        <g className="pip-prop-chalkboard pip-bot-prop">
          <rect x="242" y="132" width="122" height="86" rx="12" fill="#D97706" stroke="#1E2246" strokeWidth="4.5" strokeLinejoin="round" />
          <rect x="250" y="140" width="106" height="70" rx="7" fill="#1E4D3B" stroke="#1E2246" strokeWidth="3" />
          {/* Chalk Tray & Chalk */}
          <rect x="266" y="212" width="74" height="7" rx="3.5" fill="#FBBF24" stroke="#1E2246" strokeWidth="3" />
          <rect x="316" y="208" width="14" height="4" rx="2" fill="#FFFFFF" />
          {/* Golden Star + 'abc' */}
          <polygon points="274,162 277.5,169.5 285.5,170.5 279.8,176 281.2,184 274,180.2 266.8,184 268.2,176 262.5,170.5 270.5,169.5" fill="#FFE66D" />
          <text className="pip-text" x="292" y="182" fontWeight="700" fontSize="24" fill="#FFFFFF" letterSpacing="1">abc</text>
        </g>

        {/* Sleeping Soft Cloud Pillow + Rising Zzz */}
        <g className="pip-prop-pillow pip-bot-prop">
          <path d="M98 206 C86 192, 104 170, 126 178 C152 168, 228 168, 254 178 C276 170, 294 192, 282 206 C292 224, 272 242, 250 234 C220 242, 160 242, 130 234 C108 242, 88 224, 98 206 Z" fill="#EDE9FE" stroke="#1E2246" strokeWidth="4.5" strokeLinejoin="round" />
          <path d="M120 202 Q190 212 260 202" fill="none" stroke="#C4B5FD" strokeWidth="3.5" strokeLinecap="round" />
          <text className="pip-text pip-anim-zzz-1" x="272" y="128" fontWeight="700" fontSize="20" fill="#7C3AED">z</text>
          <text className="pip-text pip-anim-zzz-2" x="290" y="108" fontWeight="700" fontSize="26" fill="#6D28D9">Z</text>
          <text className="pip-text pip-anim-zzz-3" x="310" y="86" fontWeight="700" fontSize="32" fill="#5B21B6">Z</text>
        </g>

        {/* Storytelling Orbiting Planet & Magic Sparkles */}
        <g className="pip-prop-magic-aura pip-bot-prop">
          <g className="pip-anim-float-slow">
            <circle cx="64" cy="96" r="13" fill="#FFB703" stroke="#1E2246" strokeWidth="4" />
            <ellipse cx="64" cy="96" rx="22" ry="5.5" transform="rotate(-22 64 96)" fill="none" stroke="#6EE7D8" strokeWidth="3.8" />
          </g>
          <path className="pip-anim-float-fast" d="M306 104 C318 94, 330 108, 319 119 C310 127, 300 116, 308 110" fill="none" stroke="#A855F7" strokeWidth="4" strokeLinecap="round" />
          <polygon points="302,68 305,75 312,78 305,81 302,88 299,81 292,78 299,75" fill="#FFD447" />
          <circle className="pip-anim-float-fast" cx="78" cy="144" r="4.5" fill="#F472B6" />
        </g>

        {/* Celebrating Fireworks & Confetti */}
        <g className="pip-prop-celebrate-fx pip-bot-prop">
          <g className="pip-anim-confetti" stroke="#F43F5E" strokeWidth="3.5" strokeLinecap="round">
            <line x1="68" y1="74" x2="68" y2="58" />
            <line x1="68" y1="98" x2="68" y2="112" />
            <line x1="56" y1="86" x2="42" y2="86" />
            <line x1="80" y1="86" x2="94" y2="86" />
            <line x1="59" y1="77" x2="50" y2="68" />
            <line x1="77" y1="95" x2="86" y2="104" />
          </g>
          <g className="pip-anim-confetti" stroke="#F59E0B" strokeWidth="3.5" strokeLinecap="round">
            <line x1="312" y1="74" x2="312" y2="58" />
            <line x1="312" y1="98" x2="312" y2="112" />
            <line x1="300" y1="86" x2="286" y2="86" />
            <line x1="324" y1="86" x2="338" y2="86" />
            <line x1="303" y1="95" x2="294" y2="104" />
            <line x1="321" y1="77" x2="330" y2="68" />
          </g>
          <rect className="pip-anim-float-fast" x="92" y="132" width="9" height="9" rx="2" fill="#38BDF8" transform="rotate(20 96 136)" />
          <rect className="pip-anim-float-slow" x="282" y="130" width="9" height="9" rx="2" fill="#A855F7" transform="rotate(-18 286 134)" />
          <circle cx="116" cy="54" r="5" fill="#34D399" />
          <circle cx="264" cy="54" r="5" fill="#F472B6" />
        </g>

        {/* Singing Musical Notes */}
        <g className="pip-prop-music-notes pip-bot-prop">
          <g className="pip-anim-float-fast" fill="#7C3AED" stroke="#1E2246" strokeWidth="2.5" strokeLinejoin="round">
            <circle cx="72" cy="116" r="6" />
            <path d="M77 116 L77 92 L92 88 L92 112" fill="none" strokeWidth="4" strokeLinecap="round" />
            <circle cx="87" cy="112" r="6" />
          </g>
          <g className="pip-anim-float-slow" fill="#EC4899" stroke="#1E2246" strokeWidth="2.5" strokeLinejoin="round">
            <circle cx="304" cy="108" r="6" />
            <path d="M309 108 L309 84 L320 88" fill="none" strokeWidth="4" strokeLinecap="round" />
          </g>
        </g>

        {/* Happy / Proud / Shy Floating Hearts & Stars */}
        <g className="pip-prop-hearts-stars pip-bot-prop">
          <path className="pip-anim-float-slow" d="M76 96 C76 96, 63 87, 63 80 C63 75.5, 66.5 72.5, 70.5 72.5 C73.2 72.5, 75.2 74, 76 76 C76.8 74, 78.8 72.5, 81.5 72.5 C85.5 72.5, 89 75.5, 89 80 C89 87, 76 96, 76 96 Z" fill="#FF6B8B" stroke="#1E2246" strokeWidth="3" />
          <path className="pip-anim-float-fast" d="M306 94 C306 94, 294 86, 294 79.5 C294 75.5, 297 73, 300.5 73 C303 73, 305 74.2, 306 76 C307 74.2, 309 73, 311.5 73 C315 73, 318 75.5, 318 79.5 C318 86, 306 94, 306 94 Z" fill="#FF6B8B" stroke="#1E2246" strokeWidth="3" />
          <polygon points="310,136 313,143 320,146 313,149 310,156 307,149 300,146 307,143" fill="#FFD447" />
          <polygon points="68,142 70.5,147.5 76,150 70.5,152.5 68,158 65.5,152.5 60,150 65.5,147.5" fill="#FFD447" />
        </g>

        {/* Giggle Motion Lines & Notes */}
        <g className="pip-prop-giggle-fx pip-bot-prop">
          <g stroke="#1E2246" strokeWidth="3.5" strokeLinecap="round">
            <line x1="56" y1="114" x2="68" y2="120" />
            <line x1="52" y1="136" x2="66" y2="136" />
            <line x1="324" y1="114" x2="312" y2="120" />
            <line x1="328" y1="136" x2="314" y2="136" />
          </g>
          <circle cx="298" cy="84" r="5" fill="#F59E0B" />
          <path d="M302 84 L302 66 L312 69" fill="none" stroke="#1E2246" strokeWidth="3.5" strokeLinecap="round" />
        </g>

        {/* Sad Little Raincloud */}
        <g className="pip-prop-raincloud pip-bot-prop">
          <path d="M276 66 C268 66, 264 58, 270 52 C272 44, 284 42, 290 48 C296 42, 308 45, 309 53 C316 56, 314 66, 305 66 Z" fill="#93C5FD" stroke="#1E2246" strokeWidth="3.5" strokeLinejoin="round" />
          <line className="pip-anim-tear" x1="280" y1="73" x2="277" y2="82" stroke="#38BDF8" strokeWidth="3" strokeLinecap="round" />
          <line className="pip-anim-tear" x1="292" y1="75" x2="289" y2="84" stroke="#38BDF8" strokeWidth="3" strokeLinecap="round" />
          <line className="pip-anim-tear" x1="303" y1="73" x2="300" y2="82" stroke="#38BDF8" strokeWidth="3" strokeLinecap="round" />
        </g>

        {/* Angry Steam Puffs & Sparks */}
        <g className="pip-prop-steam pip-bot-prop">
          <circle className="pip-anim-steam-l" cx="62" cy="96" r="10" fill="#E2E8F0" stroke="#1E2246" strokeWidth="3" />
          <circle className="pip-anim-steam-r" cx="318" cy="96" r="10" fill="#E2E8F0" stroke="#1E2246" strokeWidth="3" />
          <polyline points="118,56 112,66 122,66 116,76" fill="none" stroke="#F59E0B" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="262,56 268,66 258,66 264,76" fill="none" stroke="#F59E0B" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* Tired Yawn Bubble & Small z */}
        <g className="pip-prop-tired-fx pip-bot-prop">
          <circle className="pip-anim-float-slow" cx="72" cy="116" r="13" fill="#BAE6FD" fillOpacity="0.7" stroke="#38BDF8" strokeWidth="3" />
          <circle className="pip-anim-float-fast" cx="92" cy="94" r="7" fill="#BAE6FD" fillOpacity="0.7" stroke="#38BDF8" strokeWidth="2.5" />
          <text className="pip-text pip-anim-zzz-1" x="296" y="102" fontWeight="700" fontSize="22" fill="#0284C7">z</text>
        </g>

        {/* Waiting Clock, '?' & '...' */}
        <g className="pip-prop-waiting-fx pip-bot-prop">
          <circle cx="304" cy="78" r="18" fill="#FFFFFF" stroke="#1E2246" strokeWidth="4" />
          <polyline points="304,68 304,78 311,82" fill="none" stroke="#1E2246" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          <text className="pip-text pip-anim-float-fast" x="304" y="188" fontWeight="700" fontSize="26" fill="#1E2246">?</text>
          <g fill="#1E2246">
            <circle cx="52" cy="168" r="3.5" />
            <circle cx="64" cy="168" r="3.5" />
            <circle cx="76" cy="168" r="3.5" />
          </g>
        </g>

        {/* Jump Scared '!?' & Shock Lines */}
        <g className="pip-prop-scared-fx pip-bot-prop">
          <polyline points="72,76 54,84 68,94 50,104" fill="none" stroke="#F59E0B" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <text className="pip-text" x="294" y="88" fontWeight="700" fontSize="34" fill="#EF4444" stroke="#1E2246" strokeWidth="2">!?</text>
        </g>

        {/* Listening Sound Waves */}
        <g className="pip-prop-listen-waves pip-bot-prop">
          <path className="pip-anim-pulse-wave" d="M58 124 C48 136, 48 152, 58 164" fill="none" stroke="#06B6D4" strokeWidth="4" strokeLinecap="round" />
          <path className="pip-anim-pulse-wave" d="M46 114 C32 132, 32 156, 46 174" fill="none" stroke="#38BDF8" strokeWidth="3.5" strokeLinecap="round" />
        </g>

        {/* Talking Voice Equalizer Arcs */}
        <g className="pip-prop-talk-waves pip-bot-prop">
          <path className="pip-anim-pulse-wave" d="M318 126 C328 138, 328 152, 318 164" fill="none" stroke="#10B981" strokeWidth="4" strokeLinecap="round" />
          <path className="pip-anim-pulse-wave" d="M330 116 C344 134, 344 156, 330 174" fill="none" stroke="#34D399" strokeWidth="3.5" strokeLinecap="round" />
        </g>

        {/* Thinking Thought Bubbles */}
        <g className="pip-prop-think-bubbles pip-bot-prop">
          <circle className="pip-anim-float-fast" cx="288" cy="96" r="6" fill="#FFFFFF" stroke="#1E2246" strokeWidth="3" />
          <circle className="pip-anim-float-slow" cx="304" cy="78" r="9" fill="#FFFFFF" stroke="#1E2246" strokeWidth="3" />
          <circle className="pip-anim-float-slow" cx="326" cy="58" r="14" fill="#FEF08A" stroke="#1E2246" strokeWidth="3.5" />
        </g>

        {/* Curious Floating '?' */}
        <g className="pip-prop-curious-q pip-bot-prop">
          <text className="pip-text pip-anim-float-slow" x="296" y="88" fontWeight="700" fontSize="36" fill="#8B5CF6" stroke="#1E2246" strokeWidth="2">?</text>
        </g>
      </g>

      {/* The character itself. Layers 2 to 5 follow in this order, so the arms and hands are always on top. */}
      <g className="pip-bot-whole">

        {/* LAYER 2: torso, feet and the chest heart-gear */}
        <g className="pip-body-group">
          {/* Cute Little Robot Feet */}
          <rect x="152" y="312" width="30" height="19" rx="9.5" fill="#38BDF8" stroke="#1E2246" strokeWidth="4.5" />
          <path d="M158 325 L176 325" stroke="#FFE66D" strokeWidth="3.5" strokeLinecap="round" />

          <rect x="198" y="312" width="30" height="19" rx="9.5" fill="#38BDF8" stroke="#1E2246" strokeWidth="4.5" />
          <path d="M204 325 L222 325" stroke="#FFE66D" strokeWidth="3.5" strokeLinecap="round" />

          {/* Neck Collar */}
          <rect x="168" y="204" width="44" height="18" rx="7" fill="#38BDF8" stroke="#1E2246" strokeWidth="4.5" />

          {/* Rounded Yellow & Mint-Cyan Torso */}
          <path d="M136 220 C136 213, 244 213, 244 220 L251 286 C253 305, 235 318, 190 318 C145 318, 127 305, 129 286 Z" fill={`url(#${ids.torsoGrad})`} stroke="#1E2246" strokeWidth="4.5" strokeLinejoin="round" />

          {/* Torso Top Shine */}
          <path d="M152 224 Q190 220 228 224" fill="none" stroke="#FFFFFF" strokeWidth="3.5" strokeLinecap="round" opacity="0.72" />

          {/* Chest Display Screen */}
          <rect x="168" y="236" width="44" height="42" rx="11" fill="#1b243b" stroke="#1E2246" strokeWidth="4" />

          {/* Rotating Golden Heart-Gear */}
          <g className="pip-chest-gear">
            <circle cx="190" cy="257" r="11" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="2.5" />
            <g fill="#FFD447" stroke="#1E2246" strokeWidth="2">
              <rect x="187.8" y="242" width="4.4" height="4.8" rx="1.2" />
              <rect x="187.8" y="267.2" width="4.4" height="4.8" rx="1.2" />
              <rect x="175" y="254.8" width="4.8" height="4.4" rx="1.2" />
              <rect x="200.2" y="254.8" width="4.8" height="4.4" rx="1.2" />
              <rect x="179" y="246" width="4.4" height="4.4" rx="1.2" transform="rotate(45 181.2 248.2)" />
              <rect x="196.6" y="263.6" width="4.4" height="4.4" rx="1.2" transform="rotate(45 198.8 265.8)" />
              <rect x="196.6" y="246" width="4.4" height="4.4" rx="1.2" transform="rotate(-45 198.8 248.2)" />
              <rect x="179" y="263.6" width="4.4" height="4.4" rx="1.2" transform="rotate(-45 181.2 265.8)" />
            </g>
            {/* Heart Cutout Emblem */}
            <path d="M190 262 C190 262, 183.5 257.8, 183.5 254.5 C183.5 252.5, 185.1 251.2, 187 251.2 C188.3 251.2, 189.4 252, 190 253 C190.6 252, 191.7 251.2, 193 251.2 C194.9 251.2, 196.5 252.5, 196.5 254.5 C196.5 257.8, 190 262, 190 262 Z" fill="#FF6B8B" />
          </g>

          {/* Two Vertical Indicator Dots on Chest Right */}
          <circle cx="226" cy="249" r="4" fill="#56F0FF" stroke="#1E2246" strokeWidth="2.5" />
          <circle cx="226" cy="264" r="4" fill="#FFD447" stroke="#1E2246" strokeWidth="2.5" />
        </g>

        {/* LAYER 3: head, antenna, face screen, glasses and wizard hat */}
        <g className="pip-head-group">
          {/* Star Antenna */}
          <g className="pip-antenna-group">
            <path d="M172 72 C172 60, 208 60, 208 72 Z" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="4.5" strokeLinejoin="round" />
            <line x1="190" y1="62" x2="190" y2="44" stroke="#1E2246" strokeWidth="4.5" strokeLinecap="round" />
            <g stroke="#FFD447" strokeWidth="3" strokeLinecap="round" opacity="0.9">
              <line x1="190" y1="10" x2="190" y2="16" />
              <line x1="165" y1="21" x2="170" y2="25" />
              <line x1="215" y1="21" x2="210" y2="25" />
            </g>
            <polygon points="190,17 195,27.5 206.5,29 198,37 200,48.5 190,43 180,48.5 182,37 173.5,29 185,27.5" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="4" strokeLinejoin="round" />
            <circle cx="186.5" cy="29" r="2" fill="#FFFFFF" opacity="0.9" />
          </g>

          {/* Left & Right Golden Ear-Caps */}
          <rect x="74" y="118" width="20" height="48" rx="10" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="4.5" />
          <rect x="286" y="118" width="20" height="48" rx="10" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="4.5" />

          {/* Rounded Mint-Cyan Head Bezel */}
          <rect x="90" y="72" width="200" height="138" rx="40" fill={`url(#${ids.mintGrad})`} stroke="#1E2246" strokeWidth="4.5" />
          <path d="M126 82 L254 82" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" opacity="0.72" />
          <circle cx="250" cy="202" r="2.2" fill="#1E2246" />
          <circle cx="259" cy="202" r="2.2" fill="#1E2246" />

          {/* Dark Navy Face Screen (#1b243b) */}
          <rect x="108" y="88" width="164" height="106" rx="28" fill="#1b243b" stroke="#1E2246" strokeWidth="4" />

          {/* Clipped Face Screen Interior */}
          <g clipPath={`url(#${ids.screenClip})`}>
            {/* Angry Red Visor Tint */}
            <rect className="pip-angry-screen-tint" x="108" y="88" width="164" height="106" fill={`url(#${ids.angryGrad})`} />

            {/* Subtle Screen Reflection */}
            <path d="M120 108 C120 97, 132 94, 152 94" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" opacity="0.16" />

            {/* Eyebrows */}
            <rect className="pip-brow-left" x="138" y="106" width="22" height="4.5" rx="2.25" fill="#6EE7D8" opacity="0.88" />
            <rect className="pip-brow-right" x="220" y="106" width="22" height="4.5" rx="2.25" fill="#6EE7D8" opacity="0.88" />

            {/* Coral-Pink Oval Cheeks */}
            <g className="pip-cheeks-group" opacity="0.9">
              <ellipse cx="135" cy="159" rx="11.5" ry="6.2" fill="#FF8577" />
              <ellipse cx="245" cy="159" rx="11.5" ry="6.2" fill="#FF8577" />
            </g>

            {/* EYE LAYER 1: Standard Star-Sparkle Glowing Cyan Eyes */}
            <g className="pip-eye-layer pip-eye-open">
              <g className="pip-eye-left-wrap pip-eye-open-scale">
                <circle cx="150" cy="134" r="18.5" fill="#111629" stroke="#56F0FF" strokeWidth="3.8" />
                <g className="pip-pupil-left">
                  <circle cx="150" cy="134" r="12" fill="#18223F" />
                  <circle cx="144" cy="128" r="4.6" fill="#FFFFFF" />
                  <circle cx="156" cy="140" r="2" fill="#FFFFFF" opacity="0.85" />
                  <path d="M154.5 124 L155.8 128 L159.8 129.3 L155.8 130.6 L154.5 134.6 L153.2 130.6 L149.2 129.3 L153.2 128 Z" fill="#FFE66D" />
                </g>
              </g>
              <g className="pip-eye-right-wrap pip-eye-open-scale">
                <circle cx="230" cy="134" r="18.5" fill="#111629" stroke="#56F0FF" strokeWidth="3.8" />
                <g className="pip-pupil-right">
                  <circle cx="230" cy="134" r="12" fill="#18223F" />
                  <circle cx="224" cy="128" r="4.6" fill="#FFFFFF" />
                  <circle cx="236" cy="140" r="2" fill="#FFFFFF" opacity="0.85" />
                  <path d="M234.5 124 L235.8 128 L239.8 129.3 L235.8 130.6 L234.5 134.6 L233.2 130.6 L229.2 129.3 L233.2 128 Z" fill="#FFE66D" />
                </g>
              </g>
            </g>

            {/* EYE LAYER 2: Happy / Giggle / Singing Closed Arcs (^ ^) */}
            <g className="pip-eye-layer pip-eye-happy-arcs">
              <path d="M134 138 Q150 118 166 138" fill="none" stroke="#56F0FF" strokeWidth="5.5" strokeLinecap="round" />
              <path d="M214 138 Q230 118 246 138" fill="none" stroke="#56F0FF" strokeWidth="5.5" strokeLinecap="round" />
            </g>

            {/* EYE LAYER 3: Sad Puppy Eyes + Falling Tear */}
            <g className="pip-eye-layer pip-eye-sad">
              <circle cx="150" cy="136" r="17" fill="#111629" stroke="#56F0FF" strokeWidth="3.5" />
              <circle cx="146" cy="131" r="5" fill="#FFFFFF" />
              <circle cx="155" cy="141" r="2.5" fill="#FFFFFF" />
              <circle cx="230" cy="136" r="17" fill="#111629" stroke="#56F0FF" strokeWidth="3.5" />
              <circle cx="226" cy="131" r="5" fill="#FFFFFF" />
              <circle cx="235" cy="141" r="2.5" fill="#FFFFFF" />
              <path className="pip-anim-tear" d="M246 146 C246 146, 252 155, 252 159 C252 162.5, 249.5 165, 246 165 C242.5 165, 240 162.5, 240 159 C240 155, 246 146, 246 146 Z" fill="#60EFFF" />
            </g>

            {/* EYE LAYER 4: Angry Slanted Glowing Eyes */}
            <g className="pip-eye-layer pip-eye-angry">
              <path d="M132 125 L168 136 C166 149, 150 153, 139 147 C131 142, 130 132, 132 125 Z" fill="#FFD447" stroke="#FF6B35" strokeWidth="2.5" />
              <path d="M248 125 L212 136 C214 149, 230 153, 241 147 C249 142, 250 132, 248 125 Z" fill="#FFD447" stroke="#FF6B35" strokeWidth="2.5" />
            </g>

            {/* EYE LAYER 5: Tired Half-Lidded Eyes */}
            <g className="pip-eye-layer pip-eye-tired">
              <circle cx="150" cy="136" r="16.5" fill="#111629" stroke="#56F0FF" strokeWidth="3.5" />
              <circle cx="150" cy="140" r="5.5" fill="#56F0FF" opacity="0.7" />
              <rect x="131" y="117" width="38" height="17" fill="#1b243b" />
              <line x1="133" y1="134" x2="167" y2="134" stroke="#56F0FF" strokeWidth="4.2" strokeLinecap="round" />

              <circle cx="230" cy="136" r="16.5" fill="#111629" stroke="#56F0FF" strokeWidth="3.5" />
              <circle cx="230" cy="140" r="5.5" fill="#56F0FF" opacity="0.7" />
              <rect x="211" y="117" width="38" height="17" fill="#1b243b" />
              <line x1="213" y1="134" x2="247" y2="134" stroke="#56F0FF" strokeWidth="4.2" strokeLinecap="round" />
            </g>

            {/* EYE LAYER 6: Peaceful Closed Sleeping Eyes (u u) */}
            <g className="pip-eye-layer pip-eye-sleep">
              <path d="M135 134 Q150 148 165 134" fill="none" stroke="#56F0FF" strokeWidth="5" strokeLinecap="round" />
              <path d="M215 134 Q230 148 245 134" fill="none" stroke="#56F0FF" strokeWidth="5" strokeLinecap="round" />
            </g>

            {/* EYE LAYER 7: Jump Scared Wide Shocked Eyes */}
            <g className="pip-eye-layer pip-eye-scared">
              <circle cx="150" cy="134" r="19.5" fill="#FFFFFF" stroke="#56F0FF" strokeWidth="3.8" />
              <circle cx="150" cy="134" r="6" fill="#1E2246" />
              <circle cx="230" cy="134" r="19.5" fill="#FFFFFF" stroke="#56F0FF" strokeWidth="3.8" />
              <circle cx="230" cy="134" r="6" fill="#1E2246" />
            </g>

            {/* MOUTH VARIANTS */}
            <path className="pip-mouth-layer pip-mouth-smile" d="M178 160 Q190 172 202 160" fill="none" stroke="#FFD447" strokeWidth="5" strokeLinecap="round" />

            <path className="pip-mouth-layer pip-mouth-proud" d="M174 159 Q190 176 206 159 Z" fill="#FFD447" stroke="#FFD447" strokeWidth="2.5" strokeLinejoin="round" />

            <g className="pip-mouth-layer pip-mouth-giggle">
              <path d="M174 158 Q190 161 206 158 C206 175, 198 181, 190 181 C182 181, 174 175, 174 158 Z" fill="#FF6B8B" stroke="#FFD447" strokeWidth="3.2" strokeLinejoin="round" />
              <path d="M181 176 Q190 170 199 176" fill="none" stroke="#FFA8BA" strokeWidth="3.5" strokeLinecap="round" />
            </g>

            <path className="pip-mouth-layer pip-mouth-sad" d="M178 171 Q190 159 202 171" fill="none" stroke="#FFD447" strokeWidth="5" strokeLinecap="round" />

            <line className="pip-mouth-layer pip-mouth-flat" x1="179" y1="165" x2="201" y2="165" stroke="#FFD447" strokeWidth="4.5" strokeLinecap="round" />

            <ellipse className="pip-mouth-layer pip-mouth-curious" cx="193" cy="166" rx="6.2" ry="7.2" fill="#FF6B8B" stroke="#FFD447" strokeWidth="3.2" />

            <ellipse className="pip-mouth-layer pip-mouth-yawn" cx="190" cy="167" rx="9" ry="11.5" fill="#FF6B8B" stroke="#FFD447" strokeWidth="3.2" />

            <path className="pip-mouth-layer pip-mouth-scared" d="M178 170 C178 156, 202 156, 202 170 C202 177, 178 177, 178 170 Z" fill="#FF6B8B" stroke="#FFD447" strokeWidth="3.2" />

            {/* Real-Time Lip-Sync Dynamic Mouth (--mouth-open 0..1) */}
            <g className="pip-mouth-layer pip-mouth-dynamic">
              <ellipse className="pip-dynamic-mouth-shape" cx="190" cy="164" rx="13.5" ry="10.5" fill="#FF6B8B" stroke="#FFD447" strokeWidth="3.6" />
            </g>
          </g>

          {/* Teaching Round Glasses Overlay */}
          <g className="pip-prop-glasses pip-bot-prop">
            <circle cx="150" cy="134" r="24" fill="#FFFFFF" fillOpacity="0.08" stroke="#1E2246" strokeWidth="4.5" />
            <circle cx="230" cy="134" r="24" fill="#FFFFFF" fillOpacity="0.08" stroke="#1E2246" strokeWidth="4.5" />
            <path d="M174 132 Q190 127 206 132" fill="none" stroke="#1E2246" strokeWidth="4.5" strokeLinecap="round" />
            <line x1="112" y1="128" x2="126" y2="132" stroke="#1E2246" strokeWidth="4" strokeLinecap="round" />
            <line x1="254" y1="132" x2="268" y2="128" stroke="#1E2246" strokeWidth="4" strokeLinecap="round" />
          </g>

          {/* Storytelling Purple Wizard Hat Overlay */}
          <g className="pip-prop-wizard-hat pip-bot-prop">
            <path d="M130 80 C150 73, 230 73, 250 80 C237 87, 143 87, 130 80 Z" fill={`url(#${ids.purpleGrad})`} stroke="#1E2246" strokeWidth="4.5" strokeLinejoin="round" />
            <path d="M148 77 L185 15 C189 9, 196 11, 201 20 L232 77 Z" fill={`url(#${ids.purpleGrad})`} stroke="#1E2246" strokeWidth="4.5" strokeLinejoin="round" />
            <path d="M151 70 Q190 75 229 70" fill="none" stroke="#FFD447" strokeWidth="6.5" strokeLinecap="round" />
            <polygon points="187,34 190,40 196,41 191,45 192,51 187,48 182,51 183,45 178,41 184,40" fill="#FFE66D" />
            <circle cx="205" cy="56" r="2.8" fill="#FFE66D" />
          </g>
        </g>

        {/* LAYER 4: foreground props (book, desk). Drawn before the arms, so both hands grip on top of them. */}
        <g className="pip-fg-props-layer">
          {/* Waiting Desk Surface Line */}
          <g className="pip-prop-waiting-desk pip-bot-prop">
            <line x1="88" y1="296" x2="292" y2="296" stroke="#1E2246" strokeWidth="5" strokeLinecap="round" />
          </g>

          {/* Open Magical Storybook */}
          <g className="pip-prop-book pip-bot-prop">
            <path d="M124 248 L190 262 L256 248 L250 306 L190 318 L130 306 Z" fill={`url(#${ids.purpleGrad})`} stroke="#1E2246" strokeWidth="4.5" strokeLinejoin="round" />
            <path d="M132 244 L190 257 L248 244 L243 298 L190 310 L137 298 Z" fill="#FFFDF7" stroke="#1E2246" strokeWidth="3.8" strokeLinejoin="round" />
            <line x1="190" y1="257" x2="190" y2="310" stroke="#1E2246" strokeWidth="3.5" strokeLinecap="round" />
            <line x1="146" y1="264" x2="178" y2="270" stroke="#A78BFA" strokeWidth="3.5" strokeLinecap="round" />
            <line x1="146" y1="276" x2="176" y2="282" stroke="#38BDF8" strokeWidth="3.5" strokeLinecap="round" />
            <line x1="202" y1="270" x2="234" y2="264" stroke="#F472B6" strokeWidth="3.5" strokeLinecap="round" />
            <line x1="204" y1="282" x2="234" y2="276" stroke="#FBBF24" strokeWidth="3.5" strokeLinecap="round" />
            <polygon className="pip-anim-float-fast" points="172,226 174.5,231.5 180,234 174.5,236.5 172,242 169.5,236.5 164,234 169.5,231.5" fill="#FFD447" stroke="#1E2246" strokeWidth="2" />
            <polygon className="pip-anim-float-slow" points="208,220 210.5,225.5 216,228 210.5,230.5 208,236 205.5,230.5 200,228 205.5,225.5" fill="#FF85A1" stroke="#1E2246" strokeWidth="2" />
          </g>
        </g>

        {/* LAYER 5: the arms and hands. Golden shoulders fixed at (126,232) and (254,232), a curved
            segmented tube with two rings, and a hand at the wrist in two styles ('open' and
            'curled'). PipEngine rewrites the paths and the hand transforms. */}
        <g className="pip-arms-kinematic-layer">

          {/* Left arm of the picture (Pip's own right arm) */}
          <g className="pip-arm-left-assembly">
            {/* Locked Golden Shoulder Socket at (126, 232) */}
            <circle cx="126" cy="232" r="14" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="4.5" />
            <path d="M118 226 A9 9 0 0 1 132 224" fill="none" stroke="#FFF9C4" strokeWidth="2.5" strokeLinecap="round" />

            {/* Dynamic Curved Segmented Cyan Arm Tube */}
            <path className="pip-arm-left-outline" d={left.tube} fill="none" stroke="#1E2246" strokeWidth="27" strokeLinecap="round" />
            <path className="pip-arm-left-fill" d={left.tube} fill="none" stroke={`url(#${ids.armCyanGrad})`} strokeWidth="18" strokeLinecap="round" />
            <path className="pip-arm-left-shine" d={left.tube} fill="none" stroke="#B8FFEE" strokeWidth="5" strokeLinecap="round" opacity="0.65" />
            <path className="pip-arm-left-band1" d={left.band1} fill="none" stroke="#1E2246" strokeWidth="3.8" strokeLinecap="round" />
            <path className="pip-arm-left-band2" d={left.band2} fill="none" stroke="#1E2246" strokeWidth="3.8" strokeLinecap="round" />

            {/* Shoulder Rim Cap for Seamless Joint */}
            <circle cx="126" cy="232" r="11.5" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="4.2" />

            {/* Oriented Hand Group at (wristX, wristY, handAngle) */}
            <g className="pip-hand-left-group" transform={left.hand}>
              {/* Hand-Held Prop: Curious Magnifying Glass */}
              <g className="pip-prop-magnifying-glass pip-bot-prop" transform="translate(26, -34) rotate(18)">
                <line x1="-14" y1="22" x2="-4" y2="8" stroke="#D97706" strokeWidth="7" strokeLinecap="round" />
                <line x1="-14" y1="22" x2="-4" y2="8" stroke="#1E2246" strokeWidth="3" strokeLinecap="round" />
                <circle cx="6" cy="-6" r="18" fill="#E0F2FE" fillOpacity="0.45" stroke="#FFD54F" strokeWidth="6" />
                <circle cx="6" cy="-6" r="18" fill="none" stroke="#1E2246" strokeWidth="3.8" />
                <path d="M -2 -14 A 10 10 0 0 1 12 -14" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
              </g>

              {/* STYLE A: 'open' Fanned Fingers Pose (3 fanned cyan fingers + inward right thumb + golden palm & cuff) */}
              <g className="pip-hand-left-open" display={left.style === 'open' ? undefined : 'none'}>
                {/* 3 Fanned Chubby Cyan-Mint Fingers */}
                <rect x="-5.5" y="-31" width="11" height="20" rx="5.5" transform="rotate(-28 0 -11)" fill="#64F5E8" stroke="#1E2246" strokeWidth="4" />
                <rect x="-5.8" y="-34" width="11.6" height="22" rx="5.8" fill="#64F5E8" stroke="#1E2246" strokeWidth="4" />
                <rect x="-5.5" y="-31" width="11" height="20" rx="5.5" transform="rotate(28 0 -11)" fill="#64F5E8" stroke="#1E2246" strokeWidth="4" />
                {/* Inward-Facing Cyan Thumb (on +X side for Canvas-Left Hand) */}
                <rect x="7" y="-21" width="10.5" height="15.5" rx="5.25" transform="rotate(42 12 -14)" fill="#64F5E8" stroke="#1E2246" strokeWidth="4" />
                {/* Plump Golden Palm */}
                <ellipse cx="0" cy="-10.5" rx="14.2" ry="12.2" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="4.3" />
                <path d="M -6 -15 Q 0 -18 6 -15" fill="none" stroke="#FFF9C4" strokeWidth="2.4" strokeLinecap="round" opacity="0.85" />
                {/* Golden Wrist Cuff */}
                <rect x="-13.5" y="-2" width="27" height="9.5" rx="4.75" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="4.2" />
              </g>

              {/* STYLE B: 'curled' Chubby Curled Fingers Pose (matches GIGGLE, TIRED, WAITING, READING) */}
              <g className="pip-hand-left-curled" display={left.style === 'curled' ? undefined : 'none'}>
                {/* Golden Wrist Cuff & Rounded Golden Back-of-Hand */}
                <rect x="-13.5" y="-1" width="27" height="9.5" rx="4.75" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="4.2" />
                <path d="M -14 -2 C -15 -16, 15 -16, 14 -2 Z" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="4.2" strokeLinejoin="round" />
                {/* 3 Parallel Chubby Cyan-Mint Curled Fingers */}
                <rect x="-13.5" y="-23" width="9.5" height="16.5" rx="4.75" fill="#64F5E8" stroke="#1E2246" strokeWidth="3.8" />
                <rect x="-4.75" y="-25" width="9.5" height="18" rx="4.75" fill="#64F5E8" stroke="#1E2246" strokeWidth="3.8" />
                <rect x="4" y="-23" width="9.5" height="16.5" rx="4.75" fill="#64F5E8" stroke="#1E2246" strokeWidth="3.8" />
                {/* Finger Highlight Dots */}
                <circle cx="-8.8" cy="-18" r="1.6" fill="#FFFFFF" opacity="0.85" />
                <circle cx="0" cy="-19.5" r="1.6" fill="#FFFFFF" opacity="0.85" />
                <circle cx="8.8" cy="-18" r="1.6" fill="#FFFFFF" opacity="0.85" />
              </g>
            </g>
          </g>

          {/* Right arm of the picture (Pip's own left arm) */}
          <g className="pip-arm-right-assembly">
            {/* Locked Golden Shoulder Socket at (254, 232) */}
            <circle cx="254" cy="232" r="14" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="4.5" />
            <path d="M248 224 A9 9 0 0 1 262 226" fill="none" stroke="#FFF9C4" strokeWidth="2.5" strokeLinecap="round" />

            {/* Dynamic Curved Segmented Cyan Arm Tube */}
            <path className="pip-arm-right-outline" d={right.tube} fill="none" stroke="#1E2246" strokeWidth="27" strokeLinecap="round" />
            <path className="pip-arm-right-fill" d={right.tube} fill="none" stroke={`url(#${ids.armCyanGrad})`} strokeWidth="18" strokeLinecap="round" />
            <path className="pip-arm-right-shine" d={right.tube} fill="none" stroke="#B8FFEE" strokeWidth="5" strokeLinecap="round" opacity="0.65" />
            <path className="pip-arm-right-band1" d={right.band1} fill="none" stroke="#1E2246" strokeWidth="3.8" strokeLinecap="round" />
            <path className="pip-arm-right-band2" d={right.band2} fill="none" stroke="#1E2246" strokeWidth="3.8" strokeLinecap="round" />

            {/* Shoulder Rim Cap for Seamless Joint */}
            <circle cx="254" cy="232" r="11.5" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="4.2" />

            {/* Oriented Hand Group at (wristX, wristY, handAngle) */}
            <g className="pip-hand-right-group" transform={right.hand}>
              {/* Hand-Held Prop 1: Teaching Wooden Pointer Stick (aimed at '★ abc' on chalkboard) */}
              <g className="pip-prop-pointer pip-bot-prop">
                <line x1="0" y1="-16" x2="12" y2="-66" stroke="#1E2246" strokeWidth="8" strokeLinecap="round" />
                <line x1="0" y1="-16" x2="12" y2="-66" stroke="#F59E0B" strokeWidth="4.2" strokeLinecap="round" />
                <circle cx="12" cy="-66" r="4.5" fill="#FFE66D" stroke="#1E2246" strokeWidth="2.8" />
              </g>

              {/* Hand-Held Prop 2: Singing Retro Microphone */}
              <g className="pip-prop-microphone pip-bot-prop" transform="translate(0, -24) rotate(-14)">
                <rect x="-5" y="-6" width="10" height="22" rx="4" fill="#475569" stroke="#1E2246" strokeWidth="3.8" />
                <circle cx="0" cy="-14" r="11.5" fill="#64F5E8" stroke="#1E2246" strokeWidth="4" />
                <line x1="-8" y1="-14" x2="8" y2="-14" stroke="#1E2246" strokeWidth="2.8" />
                <line x1="-6" y1="-19" x2="6" y2="-19" stroke="#1E2246" strokeWidth="2.2" />
              </g>

              {/* STYLE A: 'open' Fanned Fingers Pose (3 fanned cyan fingers + inward left thumb + golden palm & cuff) */}
              <g className="pip-hand-right-open" display={right.style === 'open' ? undefined : 'none'}>
                {/* 3 Fanned Chubby Cyan-Mint Fingers */}
                <rect x="-5.5" y="-31" width="11" height="20" rx="5.5" transform="rotate(-28 0 -11)" fill="#64F5E8" stroke="#1E2246" strokeWidth="4" />
                <rect x="-5.8" y="-34" width="11.6" height="22" rx="5.8" fill="#64F5E8" stroke="#1E2246" strokeWidth="4" />
                <rect x="-5.5" y="-31" width="11" height="20" rx="5.5" transform="rotate(28 0 -11)" fill="#64F5E8" stroke="#1E2246" strokeWidth="4" />
                {/* Inward-Facing Cyan Thumb (on -X side for Canvas-Right Hand) */}
                <rect x="-17.5" y="-21" width="10.5" height="15.5" rx="5.25" transform="rotate(-42 -12 -14)" fill="#64F5E8" stroke="#1E2246" strokeWidth="4" />
                {/* Plump Golden Palm */}
                <ellipse cx="0" cy="-10.5" rx="14.2" ry="12.2" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="4.3" />
                <path d="M -6 -15 Q 0 -18 6 -15" fill="none" stroke="#FFF9C4" strokeWidth="2.4" strokeLinecap="round" opacity="0.85" />
                {/* Golden Wrist Cuff */}
                <rect x="-13.5" y="-2" width="27" height="9.5" rx="4.75" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="4.2" />
              </g>

              {/* STYLE B: 'curled' Chubby Curled Fingers Pose */}
              <g className="pip-hand-right-curled" display={right.style === 'curled' ? undefined : 'none'}>
                <rect x="-13.5" y="-1" width="27" height="9.5" rx="4.75" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="4.2" />
                <path d="M -14 -2 C -15 -16, 15 -16, 14 -2 Z" fill={`url(#${ids.goldGrad})`} stroke="#1E2246" strokeWidth="4.2" strokeLinejoin="round" />
                <rect x="-13.5" y="-23" width="9.5" height="16.5" rx="4.75" fill="#64F5E8" stroke="#1E2246" strokeWidth="3.8" />
                <rect x="-4.75" y="-25" width="9.5" height="18" rx="4.75" fill="#64F5E8" stroke="#1E2246" strokeWidth="3.8" />
                <rect x="4" y="-23" width="9.5" height="16.5" rx="4.75" fill="#64F5E8" stroke="#1E2246" strokeWidth="3.8" />
                <circle cx="-8.8" cy="-18" r="1.6" fill="#FFFFFF" opacity="0.85" />
                <circle cx="0" cy="-19.5" r="1.6" fill="#FFFFFF" opacity="0.85" />
                <circle cx="8.8" cy="-18" r="1.6" fill="#FFFFFF" opacity="0.85" />
              </g>
            </g>
          </g>

        </g>

      </g>
    </>
  );
}

export const PipArt = memo(PipArtwork);
