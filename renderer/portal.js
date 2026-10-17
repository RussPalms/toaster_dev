// Portals: make a circle with your hands in front of the camera (the tips of your index fingers
// touching, and the tips of your thumbs, one pair above the other: a diamond or a heart works too,
// and the code calls any of them the diamond) and a round window opens in it, showing what the
// camera sees there through a look. Pull your hands apart and it grows between them; spread them
// wide and hold them there a moment (its outline thickens) and it fills the picture, with you cut
// out in front of it as you are. Pinch (thumb on index) and the next look spreads out from that
// hand in a circle (a pinch while one is still spreading brings the one after). Once it fills the
// picture, a swipe (one open hand held up a moment, then fast sideways) slides a look in after it:
// swiped left, the next; right, the one before. Every 8 bars brings the next one too, from the
// middle (once a look has had 4 seconds). Drop your hands and a window closes a moment later; once
// it fills the picture it stays (so your hands are free) until you make the circle again (a looser
// one than opens it does). The looks are the finger frame's (lens.js) and two of the reel's own:
// x-ray (white edges, with echoes spreading out from the middle) and lilac (grainy, pale). Drawn
// with WebGL. After cure.visual's TouchDesigner portals.
import { FILTERS, KEYS, LOOK_GLSL, isPinch } from './lens.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const ease = (k) => k * k * (3 - 2 * k);
// a hand's size on screen (its wrist to its middle finger's knuckle), and its palm's middle
const size = (P) => dist(P[0], P[9]);
const palm = (P) => [0, 5, 9, 13, 17].reduce((s, i) => [s[0] + P[i][0] / 5, s[1] + P[i][1] / 5], [0, 0]);

// The looks, in the order they come round: the reel's x-ray and lilac, then the finger frame's
// boldest (its own numbers for them; the portal's own two are numbered from 100).
const LOOKS = ['xray', 'lilac', 'thermal', 'comic', 'sketch', 'keyframes', 'halftone', 'film', 'dither', 'negative'];
const OWN = { xray: 100, lilac: 101 };
const ID = LOOKS.map((name) => OWN[name] ?? FILTERS.findIndex((f) => f.name === name));
const pick = (k) => ((k % LOOKS.length) + LOOKS.length) % LOOKS.length;

const HOLD = 0.15; // seconds a diamond is held before it opens a window (or closes one)
const BLINK = 0.15; // a diamond lost this long (a tracker frame or three) still counts as held
const LOST = 1.2; // seconds a window held between the hands lasts without them
// palms this far apart (of the picture's width), held there this long, fill the picture (at 0.6
// and 0.1 s it filled while still being grown; on real hands the widest spread was about 0.76)
const WIDE = 0.7;
const WIDE_HOLD = 0.35;
const WIPE = 0.4; // seconds the next look takes to spread over the window
const FILL = 0.55; // seconds the window takes to fill the picture
const SHUT = 0.35; // seconds it takes to close (from filling the picture, half as long again)

// Two hands making a diamond (or a circle): the tips of the index fingers together, and of the
// thumbs (within half a hand: on real hands a loose circle took a second to tighten), the two pairs
// apart (one above the other), the palms apart too (hands pressed flat together, praying or
// clapping, have every fingertip touching), and each hand open between its thumb and index (two
// hands pinched together, closing the finger frame, aren't one). Once one is being held, or to
// close a window, tips up to 0.7 of a hand apart count (the user's circles wobbled to there for a
// moment, and took a moment more to tighten from there). Its middle and height, or null.
function diamond(A, B, held = false) {
  const s = (size(A) + size(B)) / 2, apart = held ? 0.7 : 0.5;
  if (dist(A[4], A[8]) < 0.4 * s || dist(B[4], B[8]) < 0.4 * s) return null;
  if (dist(A[8], B[8]) > apart * s || dist(A[4], B[4]) > apart * s || dist(palm(A), palm(B)) < 0.7 * s) return null;
  const top = mid(A[8], B[8]), bottom = mid(A[4], B[4]), h = dist(top, bottom);
  return h > 0.3 * s ? { c: mid(top, bottom), h } : null;
}

// the two hands, the left one first, if there are two (the tracker now and then sees one hand
// twice: that's one)
function pairOf(seen) {
  if (seen.length < 2) return null;
  const [a, b] = seen;
  if (dist(a.P[0], b.P[0]) < 0.5 * size(a.P)) return null;
  return a.P[0][0] <= b.P[0][0] ? [a, b] : [b, a];
}

// An open hand: most of its fingers out straight (their tips well past their middle joints, seen
// from the wrist), not a fist or a point.
const FINGERS = [[8, 6], [12, 10], [16, 14], [20, 18]];
const openHand = (P) => FINGERS.filter(([tip, joint]) => dist(P[tip], P[0]) > 1.15 * dist(P[joint], P[0])).length >= 3;

// A swipe: an open hand, held about still a moment (0.3 s: a hand waving side to side never is),
// then moving fast sideways across the picture (a fifth of its width, and at least one and a half
// of the hand's own size, within 0.4 s, mostly level and all one way), while the other hand, if
// there is one, stays about put (both moving is dancing, or the hands coming together for the
// circle). track: a hand's palm over the last second, [[t, x, y, size, open]], oldest first;
// other: the other hand's over the last 0.4 s; t: now; w: the picture's width. Which way it went
// on screen (-1 left, 1 right), or 0.
export function swipeOf(track, other, t, w) {
  const go = track.filter((q) => t - q[0] <= 0.4), still = track.filter((q) => t - q[0] > 0.35 && t - q[0] <= 0.65);
  if (go.length < 3 || still.length < 4) return 0;
  const a = go[0], b = go[go.length - 1], dx = b[1] - a[1], dy = b[2] - a[2];
  const s = Math.max(...go.map((q) => q[3])), dir = Math.sign(dx);
  if (Math.abs(dx) < Math.max(0.2 * w, 1.5 * s) || Math.abs(dy) > 0.5 * Math.abs(dx)) return 0;
  let far = a[1];
  for (const q of go) {
    if ((q[1] - far) * dir > 0) far = q[1];
    else if ((far - q[1]) * dir > 0.35 * s) return 0;
  }
  if (go.filter((q) => q[4]).length < 0.6 * go.length) return 0;
  const xs = still.map((q) => q[1]), ys = still.map((q) => q[2]);
  if (Math.max(...xs) - Math.min(...xs) > 0.5 * s || Math.max(...ys) - Math.min(...ys) > 0.5 * s) return 0;
  if (other && other.length >= 2) {
    const o0 = other[0], o1 = other[other.length - 1];
    if (Math.hypot(o1[1] - o0[1], o1[2] - o0[2]) > 0.4 * Math.abs(dx)) return 0;
  }
  return dir;
}

// Each hand followed from one look of the tracker to the next by where its palm is: the nearest
// to where it was heading (at the speed it was going over its last tenth of a second), within a
// tenth of the picture's width and a little more for each moment it was lost. So a hand lost for
// a frame or two mid-swipe carries on, while one hand vanishing and the other turning up across
// the picture, or one hand the tracker sees twice, isn't a hand jumping across. A hand lost is
// kept a quarter of a second. Each look, each hand is checked for a swipe. After one, none for 0.6 s, and none back the other way for
// 1.5 s (the hand coming back). update(t, the hands on screen [{ P }], the picture's width): which
// way a swipe went, or 0.
export function createSwipes() {
  let tracks = [], at = -9, went = 0;
  return {
    update(t, hands, w) {
      const now = [];
      for (const { P } of hands) {
        const p = palm(P);
        let best = null, near = 0.5 * w;
        for (const tr of tracks) {
          if (now.includes(tr)) continue;
          const q = tr.pts[tr.pts.length - 1], r = tr.pts.find((o) => q[0] - o[0] <= 0.1) || q;
          const k = q[0] > r[0] ? (t - q[0]) / (q[0] - r[0]) : 0, gone = t - tr.seen;
          const d = Math.hypot(p[0] - q[1] - (q[1] - r[1]) * k, p[1] - q[2] - (q[2] - r[2]) * k);
          if (d < near && d < (0.1 + 0.5 * gone) * w) { near = d; best = tr; }
        }
        const tr = best || { pts: [] };
        tr.pts.push([t, p[0], p[1], size(P), openHand(P)]);
        while (t - tr.pts[0][0] > 1) tr.pts.shift();
        tr.seen = t;
        now.push(tr);
      }
      tracks = [...now, ...tracks.filter((tr) => !now.includes(tr) && t - tr.seen < 0.25)];
      for (const tr of now) {
        // (the other hand: not this one seen twice by the tracker)
        const last = tr.pts[tr.pts.length - 1];
        const other = tracks.find((o) => o !== tr && Math.hypot(o.pts[o.pts.length - 1][1] - last[1], o.pts[o.pts.length - 1][2] - last[2]) > 0.6 * last[3]);
        const dir = swipeOf(tr.pts, other ? other.pts.filter((q) => t - q[0] <= 0.4) : null, t, w);
        if (!dir || t - at < 0.6 || (dir === -went && t - at < 1.5)) continue;
        at = t;
        went = dir;
        tr.pts = [last];
        return dir;
      }
      return 0;
    },
  };
}

const VERT = `#version 300 es
layout(location = 0) in vec2 pos; // on screen, CSS pixels
uniform vec2 size;
out vec2 vP;
void main() {
  vP = pos;
  gl_Position = vec4(pos.x / size.x * 2.0 - 1.0, 1.0 - pos.y / size.y * 2.0, 0.0, 1.0);
}`;

// The portal's own looks, beside the finger frame's.
const PORTAL_GLSL = `
#define P_XRAY ${OWN.xray}
#define P_LILAC ${OWN.lilac}
// x-ray: the edges glowing white (flaring on the kick) over the picture's light turned down and
// over, so a lit wall goes dark and a face is all lines
vec3 xray(vec2 p) {
  vec2 t = tex(p), s = texel * 1.5;
  float a = lum(texture(cam, t + s * vec2(-1.0, -1.0)).rgb), b = lum(texture(cam, t + s * vec2(0.0, -1.0)).rgb), d = lum(texture(cam, t + s * vec2(1.0, -1.0)).rgb);
  float e = lum(texture(cam, t + s * vec2(-1.0, 0.0)).rgb), g = lum(texture(cam, t + s * vec2(1.0, 0.0)).rgb);
  float h = lum(texture(cam, t + s * vec2(-1.0, 1.0)).rgb), i = lum(texture(cam, t + s * vec2(0.0, 1.0)).rgb), j = lum(texture(cam, t + s * vec2(1.0, 1.0)).rgb);
  float gx = d + 2.0 * g + j - a - 2.0 * e - h, gy = h + 2.0 * i + j - a - 2.0 * b - d;
  float edge = clamp(length(vec2(gx, gy)) * 2.4 * (1.0 + 0.8 * pulse) - 0.06, 0.0, 1.0);
  float l = lum(texture(cam, t).rgb);
  return clamp(vec3(0.94, 0.97, 1.0) * (edge + (1.0 - l) * 0.22), 0.0, 1.0);
}
// a grain for each pixel (p, in device pixels) and frame (k): an integer hash, as the sine one
// draws diagonal stripes at large pixel numbers
float grain(vec2 p, float k) {
  uvec2 q = uvec2(ivec2(p) + 32768) ^ uvec2(uint(k) * 747796405u);
  q *= uvec2(1597334673u, 3812015801u);
  return float((q.x ^ q.y) * 1597334673u) / 4294967295.0;
}
// lilac: the light gone pale lilac and the shadows a grainy plum, the grain new 12 times a second
vec3 lilac(vec2 p) {
  float g = grain(floor(p * dpr), floor(mod(time, 100.0) * 12.0)) - 0.5;
  float v = smoothstep(0.06, 0.5, lum(at(p)) + g * 0.24);
  return mix(vec3(0.15, 0.1, 0.22), vec3(0.97, 0.93, 1.0), v);
}
vec3 portalLook(int f, vec2 p, vec2 uv) {
  if (f == P_XRAY) return xray(p);
  if (f == P_LILAC) return lilac(p);
  return look(f, p, uv);
}`;

// A look in the window, the x-ray's with its echoes. Drawn once for the look now, and again for
// the next one inside the circle it spreads out in (one look a draw: a shader that could draw two
// of the finger frame's filters ran seven times slower, even drawing one).
const PAINT = `#version 300 es
precision highp float;
in vec2 vP;
out vec4 color;
${LOOK_GLSL}
${PORTAL_GLSL}
uniform sampler2D echo;  // the x-ray's echoes
uniform vec4 rect;       // the camera's picture on screen: x0, y0, x1, y1 (CSS pixels)
uniform vec2 view;       // the canvas (CSS pixels)
uniform vec3 circ;       // the window: its middle and radius (CSS pixels)
uniform vec4 wipe;       // only inside this circle: its middle, radius and how soft its edge (0: all)
uniform int which;       // the look
void main() {
  vec2 p = vP;
  if (p.x < rect.x || p.y < rect.y || p.x > rect.z || p.y > rect.w) discard;
  float a = 1.0 - smoothstep(circ.z - 0.8, circ.z + 0.8, length(p - circ.xy));
  if (wipe.w > 0.0) a *= 1.0 - smoothstep(wipe.z - wipe.w, wipe.z + wipe.w, length(p - wipe.xy));
  if (a <= 0.0) discard;
  vec3 c = portalLook(which, p, (p - rect.xy) / (rect.zw - rect.xy));
  if (which == P_XRAY) c = max(c, texture(echo, vec2(p.x / view.x, 1.0 - p.y / view.y)).rgb);
  color = vec4(c * a, a);
}`;

// Over the look: you, cut out as you are (filling the picture), and the outline.
const OVER = `#version 300 es
precision highp float;
in vec2 vP;
out vec4 color;
${LOOK_GLSL}
uniform sampler2D mask;  // where a person is (0-1), in the camera's own frame
uniform vec4 rect;
uniform vec3 circ;
uniform float cut;       // 0-1: how much you're cut out in front
uniform float ring;      // the outline's width (CSS pixels)
void main() {
  vec2 p = vP;
  if (p.x < rect.x || p.y < rect.y || p.x > rect.z || p.y > rect.w) discard;
  float d = length(p - circ.xy);
  float edge = 1.0 - smoothstep(ring * 0.5 - 0.8, ring * 0.5 + 0.8, abs(d - circ.z));
  float you = cut > 0.0 ? cut * smoothstep(0.5, 0.8, texture(mask, tex(p)).r) * (1.0 - smoothstep(circ.z - 0.8, circ.z + 0.8, d)) : 0.0;
  float a = edge + you * (1.0 - edge);
  if (a <= 0.0) discard;
  vec3 c = vec3(edge);
  if (you > 0.0) c += at(p) * you * (1.0 - edge);
  color = vec4(c, a);
}`;

// The x-ray's echoes: each frame what it shows now, over what it showed a frame ago (a little
// bigger, spread out from the window's middle, and fainter), kept at half size.
const ECHO = `#version 300 es
precision highp float;
in vec2 vP;
out vec4 color;
${LOOK_GLSL}
${PORTAL_GLSL}
uniform sampler2D before;
uniform vec2 view;
uniform vec2 focus;  // where they spread out from (CSS pixels)
uniform float grow;  // how much bigger they get each frame
uniform float keep;  // and how much of them is kept
void main() {
  vec2 q = focus + (vP - focus) / grow;
  vec3 old = texture(before, vec2(q.x / view.x, 1.0 - q.y / view.y)).rgb * keep;
  color = vec4(max(xray(vP) * 0.9, old), 1.0);
}`;

export function createPortal(canvas) {
  let gl = null, paint = null, over = null, echoes = null, parallel = null, ready = false, broken = false;
  let vao = null, buf = null, camTex = null, maskTex = null, maskFor = null, maskAt = -9;
  let fbo = [], fboW = 0, fboH = 0, cur = 0, echoFresh = false;
  const quad = new Float32Array(12);
  // the window: 'shut', 'held' (between the hands), 'full' (filling the picture) or 'closing';
  // its middle and radius, and where the hands would have them
  let phase = 'shut', c = [0, 0], r = 0, want = [0, 0], wantR = 0;
  // since when a diamond has been held, when and where it was last seen, and since when there's
  // been none (a diamond closes the window only once the one it opened with has been let go, and
  // opens one only once the one that closed the last has been); when a hand was last seen; since
  // when the hands have been spread wide; when it began to fill the picture or to close, and from
  // where
  let since = null, diaAt = -9, lastDia = null, freeSince = null, armed = false, needFree = false, seenAt = -9, wideSince = null, fullAt = 0, shutAt = 0, from = null;
  // the look, since when, the next one spreading out (and the one asked for meanwhile, to spread
  // out next), the pinches being held, the hands followed for swipes (and the tracker's last look)
  let which = -1, lookAt = 0, wipe = null, queued = null, pinches = [], lastBar = null, cutNow = 0;
  let swipes = createSwipes(), lastHands = null;
  let pulse = 0, keyset = 0, keyAt = -1e9, last = 0, drawn = false, shown = { R: 0, C: [0, 0] };

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); ready = false; paint = over = echoes = null; fbo = []; });
  canvas.addEventListener('webglcontextrestored', () => { ready = false; paint = over = echoes = null; fbo = []; });

  // (built in the background where the driver allows it, as the finger frame's are)
  function program(fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    return { prog: p };
  }
  function build() {
    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) { broken = true; return; }
    parallel = gl.getExtension('KHR_parallel_shader_compile');
    paint = program(PAINT);
    over = program(OVER);
    echoes = program(ECHO);
  }
  const SHARED = ['size', 'cam', 'glyphs', 'box', 'texel', 'cardSize', 'corner', 'pulse', 'time', 'dpr', 'light', 'bg', 'fg', 'cell', 'keys', 'view'];
  function init() {
    const all = [paint, over, echoes];
    if (parallel && all.some((p) => !gl.getProgramParameter(p.prog, parallel.COMPLETION_STATUS_KHR))) return false;
    for (const p of all) {
      if (!gl.getProgramParameter(p.prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(p.prog) || gl.getAttachedShaders(p.prog).map((s) => gl.getShaderInfoLog(s)).join(' '));
      }
    }
    const where = (p, names) => Object.fromEntries(names.map((k) => [k, gl.getUniformLocation(p.prog, k)]));
    paint.loc = where(paint, [...SHARED, 'echo', 'rect', 'circ', 'wipe', 'which']);
    over.loc = where(over, [...SHARED, 'mask', 'rect', 'circ', 'cut', 'ring']);
    echoes.loc = where(echoes, [...SHARED, 'before', 'focus', 'grow', 'keep']);
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    const texture = (unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      const tx = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tx;
    };
    maskTex = texture(2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    camTex = texture(0);
    // (the camera on 0, the ASCII glyphs the looks never use here on 1, the cut-out on 2, the
    // echoes on 3)
    for (const p of all) { gl.useProgram(p.prog); gl.uniform1i(p.loc.cam, 0); gl.uniform1i(p.loc.glyphs, 1); }
    gl.useProgram(paint.prog);
    gl.uniform1i(paint.loc.echo, 3);
    gl.useProgram(over.prog);
    gl.uniform1i(over.loc.mask, 2);
    gl.useProgram(echoes.prog);
    gl.uniform1i(echoes.loc.before, 3);
    maskFor = null;
    ready = true;
    return true;
  }

  // the echoes' two buffers (each frame drawn from the other), half the canvas's size
  function echoBuffers(w, h) {
    if (fbo.length && fboW === w && fboH === h) return;
    for (const f of fbo) { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); }
    fbo = [0, 1].map(() => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { fb, tex };
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    fboW = w;
    fboH = h;
    echoFresh = false;
  }

  const blank = () => {
    if (drawn && ready) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    drawn = false;
  };
  function open(t, dia, bar) {
    phase = 'held';
    which++;
    lookAt = t;
    c = dia.c.slice();
    want = dia.c.slice();
    r = 0;
    wantR = 0.4 * dia.h;
    armed = false;
    wipe = queued = null;
    wideSince = null;
    echoFresh = false;
    lastBar = bar;
  }
  function close(t, to) {
    from = { C: shown.C.slice(), R: shown.R, to: to || shown.C.slice(), cut: cutNow, long: phase === 'full' };
    phase = 'closing';
    shutAt = t;
    armed = false;
    needFree = true;
    wipe = queued = null;
  }
  // the next look (step 1; -1, the one before) spreading out over the window from p, in a circle
  // growing from r0 to r1 (left out: from nothing to past the window's far side)
  const startWipe = (t, p, step = 1, r0 = 0, r1 = null) => { wipe = { p, at: t, to: which + step, r0, r1 }; };
  // (asked for while a look is still spreading: as soon as that's done)
  const askWipe = (t, ...how) => { if (wipe) queued = how; else startWipe(t, ...how); };

  return {
    // is a window open (or opening, or closing)? Filling the picture? And should the tracker find
    // where you are (for the cut-out, asked for a little before it's needed: the model takes a
    // moment to load the first time)?
    get showing() { return phase !== 'shut'; },
    get full() { return phase === 'full'; },
    get wantsCut() { return phase === 'full' || (phase === 'held' && r > 0.18 * Math.min(innerWidth, innerHeight)); },
    // for checking: what it's doing, the look, and the window on screen
    get state() { return { phase, look: LOOKS[pick(which)], next: wipe ? LOOKS[pick(wipe.to)] : null, from: wipe?.p ?? null, queued: !!queued, c: shown.C, r: shown.R, cut: cutNow }; },
    clear() { blank(); phase = 'shut'; since = lastDia = freeSince = wideSince = wipe = queued = from = lastHands = null; diaAt = -9; needFree = false; pinches = []; swipes = createSwipes(); r = cutNow = 0; shown = { R: 0, C: [0, 0] }; },
    // a kick: the outline swells and the x-ray's edges flare, for a moment, and the keyframes
    // jump to their next colours (calm: gentler, and new colours at most every 2 seconds)
    kick(s, calm = false) {
      pulse = Math.max(pulse, calm ? 0.25 + 0.2 * Math.min(1, s) : 0.6 + 0.4 * Math.min(1, s));
      const now = performance.now();
      if (now - keyAt > (calm ? 2000 : 450)) { keyset++; keyAt = now; }
    },
    // hands: from the tracker; place(x, y): a camera point (0-1, not mirrored) on screen; rect:
    // where the camera's picture is on screen; video: the camera; mask: where a person is (from
    // the tracker, or null); col: the theme's colours; bar: the bar number.
    draw(t, { hands, place, rect, video, mask, col, bar }) {
      if (broken || gl?.isContextLost()) return;
      if (!ready) {
        try {
          if (!paint) build();
          if (broken || !init()) return;
        } catch (err) { if (!gl?.isContextLost()) { broken = true; console.error('portals:', err); } return; }
      }
      const dt = clamp(t - last, 0, 0.1);
      last = t;
      pulse *= Math.exp(-dt / 0.15);
      const W = innerWidth, H = innerHeight;
      const dpr = Math.min(1.5, devicePixelRatio || 1), w = Math.round(W * dpr), h = Math.round(H * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; drawn = true; echoFresh = false; }
      if (!rect || !video) { if (phase !== 'shut') this.clear(); else blank(); return; }
      // (a moment without a picture from the camera, a stutter: everything stays as it is)
      if (video.readyState < 2) return;

      const seen = hands.map((hd) => {
        const P = hd.points.map(([x, y]) => place(x, y));
        return { P, views: hd.world ? [hd.world, P] : [P] };
      });
      if (seen.length) seenAt = t;
      const two = pairOf(seen);
      // (the finger frame may be open as the hands come round into the circle: the circle wins)
      const dia = two ? diamond(two[0].P, two[1].P, since !== null || (armed && (phase === 'held' || phase === 'full'))) : null;
      // a diamond held a moment opens a window in it, or closes the one that's open (once the
      // diamond it opened with has been let go for a moment); the tracker losing a hand for a
      // frame or three doesn't start the moment again
      if (dia) { since ??= t; diaAt = t; lastDia = dia; freeSince = null; }
      // (let go means gone for 0.4 s, either way: on real hands the tracker garbled a finger for
      // 0.2 s in the middle of a closing circle, and the window opened again at once)
      else if (t - diaAt > BLINK) { since = null; lastDia = null; freeSince ??= t; if (t - freeSince > 0.4) { armed = true; needFree = false; } }
      const made = lastDia && since !== null && t - since >= HOLD ? lastDia : null;
      if (made && phase === 'shut' && !needFree) open(t, made, bar);
      else if (made && armed && (phase === 'held' || phase === 'full')) close(t, made.c);

      if (phase === 'held') {
        if (two) {
          // between the hands, its edge about at each palm, so it grows as soon as they start to
          // part; in the circle while they still make one
          const a = palm(two[0].P), b = palm(two[1].P), s = (size(two[0].P) + size(two[1].P)) / 2;
          want = dia ? dia.c : mid(a, b);
          wantR = Math.max(dia ? 0.4 * dia.h : 0, 0.3 * s, dist(a, b) / 2 - 0.35 * s);
          // spread wide (most of the picture's width apart) and held there, it fills the picture
          if (dist(a, b) > WIDE * rect.w) { wideSince ??= t; if (t - wideSince > WIDE_HOLD) { phase = 'full'; fullAt = t; wideSince = null; } }
          else wideSince = null;
        }
        if (t - seenAt > LOST) close(t, null);
      }
      if (phase === 'held') {
        const k = 1 - Math.exp(-dt * 20);
        c = lerp(c, want, k);
        r += (wantR - r) * k;
      }

      // a new pinch: the next look spreads out from it (one made while a look is still spreading:
      // the one after, as soon as that's done). A pinch is new once the one held there has been
      // let go (thumb and index well apart, not just past the line), or not seen for 0.3 s (the
      // tracker losing a hand for a frame or three isn't letting go).
      if ((phase === 'held' || phase === 'full') && !dia) {
        const now = [];
        for (const hd of two || seen.slice(0, 1)) {
          const p = mid(hd.P[4], hd.P[8]), s = size(hd.P);
          if (!isPinch(hd.views)) {
            if (dist(hd.P[4], hd.P[8]) > 0.45 * s) pinches = pinches.filter((q) => dist(q.p, p) > s);
            continue;
          }
          if (!pinches.some((q) => dist(q.p, p) < s)) askWipe(t, p);
          now.push({ p, t });
        }
        pinches = [...pinches.filter((q) => t - q.t < 0.3 && !now.some((n) => dist(n.p, q.p) < 1)), ...now];
      } else pinches = [];
      // a swipe, once the window fills the picture (and not while the hands come round into the
      // circle): the look slides in after the hand, its edge a circle so big it's all but straight,
      // from the side the hand came from (swiped left, the next; right, the one before)
      if (hands !== lastHands) {
        lastHands = hands;
        const went = swipes.update(t, seen, rect.w);
        if (went && phase === 'full' && since === null && t - diaAt > 0.4) {
          const far = 10 * rect.w;
          askWipe(t, [went < 0 ? rect.x + rect.w + far : rect.x - far, rect.y + rect.h / 2], -went, far, far + rect.w + 60);
        }
      }
      // and every 8 bars, from the middle (from the hand, it looked like a pinch answered late)
      if ((phase === 'held' || phase === 'full') && bar !== null && bar !== undefined && bar !== lastBar) {
        if (lastBar !== null && bar % 8 === 0 && !wipe && t - lookAt > 4) startWipe(t, c.slice());
        lastBar = bar;
      }
      if (wipe && t - wipe.at >= WIPE) {
        which = wipe.to;
        lookAt = t;
        wipe = null;
        if (queued) { startWipe(t, ...queued); queued = null; }
      }

      // where it is now: between the hands, filling the picture, or closing
      const corners = [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]];
      let C = c, R = r, cutTo = 0;
      if (phase === 'full') {
        const k = ease(clamp((t - fullAt) / FILL, 0, 1)), far = Math.max(...corners.map((q) => dist(q, c))) + 12;
        R = r + (far - r) * k;
        cutTo = k;
      }
      if (phase === 'closing') {
        const k = ease(clamp((t - shutAt) / (SHUT * (from.long ? 1.5 : 1)), 0, 1));
        C = lerp(from.C, from.to, k);
        R = from.R * (1 - k);
        cutNow = from.cut * (1 - k);
        if (k >= 1) { phase = 'shut'; cutNow = 0; }
      } else {
        // (you're cut out only while the tracker keeps finding where you are: its mask is null
        // once it's half a second old)
        if (mask) {
          if (mask !== maskFor) {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, maskTex);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mask.w, mask.h, 0, gl.RED, gl.UNSIGNED_BYTE, mask.data);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
            maskFor = mask;
          }
          maskAt = t;
        }
        if (t - maskAt > 0.6) cutTo = 0;
        cutNow += (cutTo - cutNow) * (1 - Math.exp(-dt * 8));
      }
      shown = { R, C };
      if (phase === 'shut' || R < 0.5) { blank(); return; }

      // the camera's picture, and where its frame's corners are on screen (mirrored): the looks
      // find what's at a point through these, as the finger frame's do through its box
      const P0 = place(0, 0), P1 = place(1, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, camTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      const lum = ([r0, g0, b0]) => r0 + g0 + b0;
      const shared = (L) => {
        gl.uniform2f(L.size, W, H);
        gl.uniform2f(L.view, W, H);
        gl.uniform4f(L.box, P0[0], P0[1], P1[0], P1[1]);
        gl.uniform2f(L.texel, 1 / (video.videoWidth || 1280), 1 / (video.videoHeight || 720));
        gl.uniform2f(L.cardSize, rect.w, rect.h);
        gl.uniform2fv(L.corner, corners[0].concat(corners[1], corners[3], corners[2]));
        gl.uniform1f(L.pulse, pulse);
        gl.uniform1f(L.time, t % 1000);
        gl.uniform1f(L.dpr, dpr);
        gl.uniform1f(L.light, lum(col.fg) < lum(col.bg) ? 1 : 0);
        gl.uniform3f(L.bg, col.bg[0] / 255, col.bg[1] / 255, col.bg[2] / 255);
        gl.uniform3f(L.fg, col.fg[0] / 255, col.fg[1] / 255, col.fg[2] / 255);
        gl.uniform2f(L.cell, 8.4, 14);
        gl.uniform3fv(L.keys, KEYS[keyset % KEYS.length].flat());
      };
      const box = (x0, y0, x1, y1) => {
        quad.set([x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1]);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, quad, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      };
      gl.bindVertexArray(vao);
      gl.disable(gl.BLEND);
      const now = ID[pick(which)], next = wipe ? ID[pick(wipe.to)] : -1;

      // the x-ray's echoes, while it shows (started afresh each time it comes back)
      if (now === OWN.xray || next === OWN.xray) {
        const ew = Math.max(1, Math.round(w / 2)), eh = Math.max(1, Math.round(h / 2));
        echoBuffers(ew, eh);
        if (!echoFresh) {
          for (const f of fbo) { gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
          echoFresh = true;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[1 - cur].fb);
        gl.viewport(0, 0, ew, eh);
        gl.useProgram(echoes.prog);
        shared(echoes.loc);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, fbo[cur].tex);
        gl.uniform2f(echoes.loc.focus, C[0], C[1]);
        gl.uniform1f(echoes.loc.grow, 1 + 0.012 * dt * 60);
        gl.uniform1f(echoes.loc.keep, 0.93 ** (dt * 60));
        box(0, 0, W, H);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        cur = 1 - cur;
      } else echoFresh = false;

      // the look now over the window; the next inside the circle it spreads out in, over that; then
      // you (cut out) and the outline over both
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // (the outline thickens while the hands are spread wide, until the window fills the picture)
      const charge = phase === 'held' && wideSince !== null ? clamp((t - wideSince) / WIDE_HOLD, 0, 1) : 0;
      const lw = 5 + 3 * pulse + 7 * charge, pad = lw + 2;
      const clip = (x0, y0, x1, y1) => box(Math.max(rect.x, x0), Math.max(rect.y, y0), Math.min(rect.x + rect.w, x1), Math.min(rect.y + rect.h, y1));
      gl.useProgram(paint.prog);
      shared(paint.loc);
      if (fbo.length) { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, fbo[cur].tex); }
      gl.uniform4f(paint.loc.rect, rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
      gl.uniform3f(paint.loc.circ, C[0], C[1], R);
      gl.uniform4f(paint.loc.wipe, 0, 0, 0, 0);
      gl.uniform1i(paint.loc.which, now);
      clip(C[0] - R - 1, C[1] - R - 1, C[0] + R + 1, C[1] + R + 1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (wipe) {
        // (quick at first, so a pinch shows at once)
        const k = 1 - (1 - clamp((t - wipe.at) / WIPE, 0, 1)) ** 3, soft = 6 + 0.04 * R;
        const reach = wipe.r1 === null ? k * (dist(wipe.p, C) + R + 40) : wipe.r0 + k * (wipe.r1 - wipe.r0);
        gl.uniform4f(paint.loc.wipe, wipe.p[0], wipe.p[1], reach, soft);
        gl.uniform1i(paint.loc.which, next);
        const o = reach + soft;
        clip(Math.max(C[0] - R, wipe.p[0] - o) - 1, Math.max(C[1] - R, wipe.p[1] - o) - 1, Math.min(C[0] + R, wipe.p[0] + o) + 1, Math.min(C[1] + R, wipe.p[1] + o) + 1);
      }
      gl.useProgram(over.prog);
      shared(over.loc);
      gl.uniform4f(over.loc.rect, rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
      gl.uniform3f(over.loc.circ, C[0], C[1], R);
      gl.uniform1f(over.loc.cut, cutNow);
      gl.uniform1f(over.loc.ring, lw);
      clip(C[0] - R - pad, C[1] - R - pad, C[0] + R + pad, C[1] + R + pad);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      drawn = true;
    },
  };
}
