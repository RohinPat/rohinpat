import * as THREE from "three";
import { CLUBS, at } from "@/components/offhours/golf/flight";
import type { CourseGame } from "@/components/offhours/golf/play";
import { buildHole3D, type Hole3D } from "./hole3d";
import { buildGolfer3D } from "./golfer3d";
import { createFx3D } from "./fx3d";
import type { View } from "./flyover";
import { createPutt3D } from "./putt3d";
import { replayBall } from "./replay";
import { Governor, LEVELS } from "./quality";
import type { PuttProj } from "@/components/offhours/golf/green";

// The course in WebGL. The game (play.ts) and its camera rig (playDraw.ts) are
// the 2D course's own; this draws what the camera sees: sky, hills, the hole,
// trees, the golfer, the ball and the flag. The HUD, the aim line, the ball's
// tracer and the cards are still drawn by playDraw on a clear canvas on top, with
// the same projection, so they line up with this picture exactly.
//
// The camera: the game's Cam has a position, a target, a focal length in pixels
// and a projection centre at 40% of the height. A PerspectiveCamera with a view
// offset reproduces it: the full frame is 1.2 h tall and the visible part is
// shifted down by 0.2 h, so its centre sits at 0.4 h.

const SKY_TOP = new THREE.Color("#4f92d0");
const SKY_LOW = new THREE.Color("#a9d1ec");
const HAZE = new THREE.Color("#d4e6e6");
/** the sun: from the right and behind the golfer at address on most holes, 42 degrees up */
const SUN = new THREE.Vector3(0.45, 0.72, -0.53).normalize();
/** the ball is never drawn smaller than this radius, px, nor the flag shorter than this, px */
const BALL_MIN_PX = 2.2;
const FLAG_MIN_PX = 34;
const BALL_R = 0.0214;

export type CourseRenderer = {
  /** draw the game; `view` puts the camera somewhere other than the game's (the flyover, the title screen) */
  render: (g: CourseGame, w: number, h: number, view?: View) => void;
  /** the putt's map between the screen and the green through the last frame's camera */
  puttProj: (g: CourseGame) => PuttProj;
  dispose: () => void;
  /** draw calls, triangles and device pixels of the last frame (for the perf test) */
  info: () => { calls: number; triangles: number; pixels: number; soft: boolean; fx: number; level: number };
};

/**
 * `level` is where the quality starts (quality.ts: 0 the best); when frames run slow it is turned down. `maxPixels`
 * caps the pixels at every level.
 */
export function createCourseRenderer(canvas: HTMLCanvasElement, opts: { maxPixels?: number; level?: number; reduce?: boolean } = {}): CourseRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", alpha: false });
  // a software renderer (no usable GPU, or a test runner): the cheapest picture that still reads, and no governor
  const soft = isSoftware(renderer.getContext());
  const gov = soft ? null : new Governor(opts.level ?? 0);
  const pixelCap = () => (soft ? 3.5e5 : Math.min(opts.maxPixels ?? 2.4e6, LEVELS[gov!.level].pixels));
  let maxPixels = pixelCap();
  renderer.shadowMap.enabled = !soft;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = HAZE.clone();
  scene.fog = new THREE.Fog(HAZE.clone(), 180, 2600);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.3, 7000);
  // the course's frame is mirrored in x against three.js's
  const root = new THREE.Group();
  root.scale.x = -1;
  scene.add(root);

  // ---------------------------------------------------------------- sky: a gradient dome with a sun glow, and far hills
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: SKY_TOP }, low: { value: SKY_LOW }, haze: { value: HAZE }, sun: { value: SUN.clone().multiply(new THREE.Vector3(-1, 1, 1)) } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 top; uniform vec3 low; uniform vec3 haze; uniform vec3 sun; varying vec3 vDir;
      void main(){ float y = vDir.y; vec3 c = mix(low, top, smoothstep(0.02, 0.55, y)); c = mix(haze, c, smoothstep(-0.02, 0.09, y));
        float s = max(0.0, dot(normalize(vDir), normalize(sun))); c += vec3(1.0,0.93,0.78) * (pow(s, 24.0) * 0.35 + pow(s, 900.0) * 0.8);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);
  // a ring of far, hazy hills on the horizon
  const ridge = (() => {
    const segs = 96, pos: number[] = [];
    const R0 = 3200, R1 = 3400;
    const hgt = (i: number) => 120 + 160 * (0.5 + 0.5 * Math.sin(i * 0.37) * Math.cos(i * 0.13 + 1)) + 60 * Math.sin(i * 1.7);
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      const h0 = hgt(i), h1 = hgt(i + 1);
      const p = (a: number, r: number, y: number) => [Math.sin(a) * r, y, Math.cos(a) * r];
      pos.push(...p(a0, R0, -20), ...p(a1, R0, -20), ...p(a0, R1, h0));
      pos.push(...p(a1, R0, -20), ...p(a1, R1, h1), ...p(a0, R1, h0));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.MeshBasicMaterial({ color: "#8fb3b5", side: THREE.DoubleSide, fog: false, transparent: true, opacity: 0.85 });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = -1;
    return mesh;
  })();
  scene.add(ridge);

  // ---------------------------------------------------------------- light
  const hemi = new THREE.HemisphereLight("#d8ecff", "#55703f", 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff3dc", 3.1);
  sun.castShadow = !soft;
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 260;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  root.add(sun, sun.target);
  /** the level's shadows: the materials are rebuilt for a change of kind, the map for a change of size */
  const applyShadows = (first: boolean) => {
    if (soft) return;
    const lv = LEVELS[gov!.level];
    const type = lv.shadows === "soft" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const on = lv.shadows !== "off";
    const kind = type !== renderer.shadowMap.type || on !== sun.castShadow;
    renderer.shadowMap.type = type;
    sun.castShadow = on;
    if (sun.shadow.mapSize.x !== lv.shadowMap) {
      sun.shadow.mapSize.set(lv.shadowMap, lv.shadowMap);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    if (kind && !first)
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const x of Array.isArray(m) ? m : m ? [m] : []) x.needsUpdate = true;
      });
  };
  applyShadows(true);

  // ---------------------------------------------------------------- the ball, its shadow, the golfer
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 14, 10), new THREE.MeshLambertMaterial({ color: "#ffffff", emissive: "#3a3a36" }));
  root.add(ball);
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(1, 20),
    new THREE.MeshBasicMaterial({ color: "#0a2814", transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }),
  );
  blob.rotation.x = -Math.PI / 2;
  root.add(blob);
  const golfer = buildGolfer3D();
  root.add(golfer.group);
  const dust = createFx3D(!!opts.reduce);
  root.add(dust.group);
  const putt = createPutt3D();
  root.add(putt.group);
  // a replay's flight line, drawn in the world so the replay's camera sees it
  const TRACE_MAX = 900;
  const tracePos = new Float32Array(TRACE_MAX * 3);
  const traceGeo = new THREE.BufferGeometry();
  traceGeo.setAttribute("position", new THREE.BufferAttribute(tracePos, 3));
  const traceMat = new THREE.LineBasicMaterial({ color: "#ff6a52", transparent: true, opacity: 0.9, depthWrite: false });
  const trace = new THREE.Line(traceGeo, traceMat);
  trace.frustumCulled = false;
  trace.visible = false;
  root.add(trace);
  const flagMats: THREE.Material[] = [];
  // the shot whose landings have been shown, and how many of them
  let fxShot: CourseGame["shot"] = null;
  let fxBounce = 0;
  let fxReplay: CourseGame["replay"] = null;
  let last = 0;
  const eye = new THREE.Vector3();

  let hole: Hole3D | null = null;
  let holeOf: CourseGame["hole"] | null = null;
  let size = { w: 0, h: 0, pr: 0 };
  const hidden = new Set<number>();

  const setHole = (g: CourseGame) => {
    if (hole) {
      root.remove(hole.group);
      hole.dispose();
    }
    hole = buildHole3D(g.hole, { tier: soft ? "soft" : LEVELS[gov!.level].tier });
    // building it stalls a frame or two: not the frame rate
    gov?.hold();
    holeOf = g.hole;
    root.add(hole.group);
    hidden.clear();
    dust.clear();
    // the flag can ghost when a putt is close to the cup
    flagMats.length = 0;
    hole.flag.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) {
        m.transparent = true;
        flagMats.push(m);
      }
    });
  };

  /** trees close to the line from the camera to the ball only hide the shot: they are left out */
  const clearView = (cx: number, cz: number, bx: number, bz: number) => {
    if (!hole) return;
    const dx = bx - cx, dz = bz - cz, l2 = dx * dx + dz * dz || 1;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    hole.trees.forEach((t, ti) => {
      let dirty = false;
      for (let i = 0; i < t.pos.length / 2; i++) {
        const x = t.pos[i * 2], z = t.pos[i * 2 + 1];
        const u = Math.max(0, Math.min(1, ((x - cx) * dx + (z - cz) * dz) / l2));
        const d = Math.hypot(x - (cx + dx * u), z - (cz + dz * u));
        const key = ti * 100000 + i;
        const hide = d < 4.5 && u < 0.98;
        if (hide !== hidden.has(key)) {
          if (hide) hidden.add(key);
          else hidden.delete(key);
          t.mesh.setMatrixAt(i, hide ? zero : t.mats[i]);
          dirty = true;
        }
      }
      if (dirty) t.mesh.instanceMatrix.needsUpdate = true;
    });
  };

  const render = (g: CourseGame, w: number, h: number, view?: View) => {
    if (w < 2 || h < 2) return;
    const now = performance.now();
    const raw = last ? now - last : 0;
    const dt = Math.min(0.1, raw / 1000);
    last = now;
    // frames running slow: a level down (fewer pixels, cheaper shadows; the next hole is built lighter)
    if (gov?.frame(raw)) {
      maxPixels = pixelCap();
      applyShadows(false);
    }
    // the pixel budget: never more than maxPixels device pixels, never more than 2x
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pr = Math.min(dpr, Math.sqrt(maxPixels / (w * h)));
    if (w !== size.w || h !== size.h || pr !== size.pr) {
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
      size = { w, h, pr };
    }
    if (g.hole !== holeOf) setHole(g);
    const c = view ?? g.cam;
    // the game's camera, mirrored into three.js's frame
    camera.position.set(-c.x, c.y, c.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(-c.tx, c.ty, c.tz);
    camera.aspect = w / (1.2 * h);
    camera.fov = (2 * Math.atan((0.6 * h) / c.F) * 180) / Math.PI;
    camera.setViewOffset(w, 1.2 * h, 0, 0.2 * h, w, h);
    camera.updateProjectionMatrix();
    sky.position.copy(camera.position);
    ridge.position.set(camera.position.x, 0, camera.position.z);

    const club = CLUBS[g.club];
    const sh = g.shot;
    // where the ball is: in the air, from the shot (its heights are over the ground it was struck from); else where it lies
    let bx = g.ball[0], bz = g.ball[1];
    let air: number | null = null;
    let showBall = true;
    if (sh && g.phase === "fly") {
      const p = at(sh, g.shotT);
      bx = sh.ox + p[0];
      air = sh.oy + p[1] + BALL_R;
      bz = sh.oz + p[2];
    } else if (sh && g.phase === "rest" && !g.dropped) {
      const p = at(sh, sh.restT);
      bx = sh.ox + p[0];
      bz = sh.oz + p[2];
    }
    if (g.splash && (g.phase === "fly" || g.phase === "rest") && g.t - g.splash.t > 0) showBall = g.phase === "rest" && g.dropped && g.restT > 0.9;
    // a replay: the shot again, on its own clock
    let near = false;
    const rp = g.replay;
    trace.visible = !!rp;
    if (rp) {
      // the line from the start of the shot to where the ball is in the replay
      const sp = rp.shot.pts;
      let k = 0;
      for (let i = 0; i < rp.shot.n && k < TRACE_MAX && sp[i * 4] <= rp.t; i++, k++) {
        tracePos[k * 3] = rp.shot.ox + sp[i * 4 + 1];
        tracePos[k * 3 + 1] = rp.shot.oy + sp[i * 4 + 2] + BALL_R;
        tracePos[k * 3 + 2] = rp.shot.oz + sp[i * 4 + 3];
      }
      traceGeo.setDrawRange(0, k);
      traceGeo.attributes.position.needsUpdate = true;
      const p = replayBall(rp);
      [bx, bz] = [p[0], p[2]];
      air = p[1] + BALL_R;
      showBall = true;
      // the flag ghosts as the ball reaches the cup, so it can be seen to drop
      near = Math.hypot(bx - g.hole.pin[0], bz - g.hole.pin[1]) < 2.5;
    }
    // on the green the ball is the putt's, and the golfer steps away: the putter addresses it
    const putting = g.phase === "putt" || (g.phase === "hole-card" && !!g.putt.course && g.putt.ball.sunk);
    let ground = hole ? hole.surfaceY(bx, bz) : 0;
    let by = air ?? ground + BALL_R;
    if (putting) {
      const pb = g.putt.ball;
      [bx, bz] = g.hole.fromGreen(pb.x, pb.y);
      ground = hole ? hole.surfaceY(bx, bz) : 0;
      by = ground + BALL_R;
      // into the cup: down and out of sight
      if (pb.sunk) by -= Math.min(1, g.putt.dropT / 0.25) * BALL_R * 3;
      showBall = !pb.sunk || g.putt.dropT < 0.3;
      near = Math.hypot(pb.x - g.hole.green.cup[0], pb.y - g.hole.green.cup[1]) < 2.4 && !pb.sunk;
      putt.update(g.hole, g.putt, g.t, !!opts.reduce);
    } else putt.hide();
    ball.visible = showBall;
    const dBall = Math.hypot(bx - c.x, by - c.y, bz - c.z);
    ball.position.set(bx, by, bz);
    ball.scale.setScalar(Math.max(1, ((rp ? BALL_MIN_PX * 1.8 : BALL_MIN_PX) * dBall) / (c.F * BALL_R)));
    blob.visible = showBall;
    blob.position.set(bx, ground + 0.005, bz);
    const lift = Math.max(0, by - ground - BALL_R);
    blob.scale.setScalar(Math.max(0.035, BALL_R * 1.4 * ball.scale.x) * (1 + lift * 0.02));
    (blob.material as THREE.MeshBasicMaterial).opacity = 0.35 * Math.max(0.15, 1 - lift / 40);

    // the golfer stands at the ball until it is struck, then watches it go from where it was
    const gx = sh && (g.phase === "fly" || g.phase === "rest") ? sh.ox : g.ball[0];
    const gz = sh && (g.phase === "fly" || g.phase === "rest") ? sh.oz : g.ball[1];
    golfer.update([gx, hole ? hole.surfaceY(gx, gz) : 0, gz], g.yaw, club, g.pose);
    golfer.group.visible = !putting && !rp && Math.hypot(gx - c.x, gz - c.z) < 90;

    // the flag: waves in the wind, and grows far off so it can always be found
    if (hole) {
      const [px, pz] = g.hole.pin;
      const dFlag = Math.hypot(px - c.x, pz - c.z);
      for (const m of flagMats) m.opacity = near ? 0.3 : 1;
      hole.flag.scale.setScalar(Math.max(1, (FLAG_MIN_PX * dFlag) / (c.F * 2.4)));
      const wa = Math.atan2(g.wind[0], g.wind[1]);
      hole.cloth.rotation.y = -Math.PI / 2 + wa + Math.sin(g.t * 3.1) * 0.12;
      const pa = hole.cloth.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i);
        pa.setZ(i, Math.sin(g.t * 6 + x * 9) * 0.03 * x);
      }
      pa.needsUpdate = true;
      if (!putting) clearView(c.x, c.z, rp ? bx : gx, rp ? bz : gz);
    }

    // dust, sand and spray where the ball meets the ground
    if (sh !== fxShot) {
      fxShot = sh;
      fxBounce = 0;
      if (sh && g.phase === "fly") dust.strike(sh.ox, sh.oz, g.lie, g.yaw, hole ? hole.surfaceY(sh.ox, sh.oz) : 0);
    }
    if (rp !== fxReplay) {
      // a replay kicks up its landings again
      fxReplay = rp;
      if (rp) fxBounce = rp.shot.bounces.filter((b) => b.t <= rp.t).length;
    }
    if (sh && (g.phase === "fly" || g.phase === "rest")) {
      const upTo = g.phase === "fly" ? g.shotT : rp ? rp.t : sh.restT;
      while (fxBounce < sh.bounces.length && sh.bounces[fxBounce].t <= upTo) {
        const b = sh.bounces[fxBounce++];
        const lx = sh.ox + b.x, lz = sh.oz + b.z;
        dust.land(lx, lz, b.surface, b.vy, hole ? (b.surface === "water" ? hole.waterY(lx, lz) : hole.surfaceY(lx, lz)) : 0);
      }
    }
    dust.step(dt, eye.set(c.x, c.y, c.z), c.F);

    // the shadow camera follows what the camera looks at
    const fx = putting ? bx : sh && g.phase === "fly" ? bx : (gx + c.tx) / 2;
    const fz = putting ? bz : sh && g.phase === "fly" ? bz : (gz + c.tz) / 2;
    const fy = hole ? hole.surfaceY(fx, fz) : 0;
    sun.target.position.set(fx, fy, fz);
    sun.position.set(fx + SUN.x * 120, fy + SUN.y * 120, fz + SUN.z * 120);
    renderer.render(scene, camera);
  };

  // ---------------------------------------------------------------- the screen and the green
  const v3 = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const puttProj = (g: CourseGame): PuttProj => ({
    toScreen: (x, y) => {
      const [cx, cz] = g.hole.fromGreen(x, y);
      v3.set(-cx, hole ? hole.surfaceY(cx, cz) : 0, cz).project(camera);
      return { x: ((v3.x + 1) / 2) * size.w, y: ((1 - v3.y) / 2) * size.h };
    },
    toGreen: (px, py) => {
      // the ground at the ball's height under the pointer
      const pb = g.putt.ball;
      const [bx, bz] = g.hole.fromGreen(pb.x, pb.y);
      const y0 = hole ? hole.surfaceY(bx, bz) : 0;
      ndc.set((px / size.w) * 2 - 1, 1 - (py / size.h) * 2);
      ray.setFromCamera(ndc, camera);
      const d = ray.ray.direction, o = ray.ray.origin;
      if (d.y > -1e-4) return null;
      const t = (y0 - o.y) / d.y;
      if (t <= 0) return null;
      const [gx, gy] = g.hole.toGreen(-(o.x + d.x * t), o.z + d.z * t);
      return { x: gx, y: gy };
    },
  });

  return {
    render,
    puttProj,
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, pixels: Math.round(size.w * size.h * size.pr * size.pr), soft, fx: dust.count(), level: gov?.level ?? -1 }),
    dispose: () => {
      hole?.dispose();
      golfer.dispose();
      dust.dispose();
      putt.dispose();
      traceGeo.dispose();
      traceMat.dispose();
      skyMat.dispose();
      sky.geometry.dispose();
      ridge.geometry.dispose();
      (ridge.material as THREE.Material).dispose();
      ball.geometry.dispose();
      (ball.material as THREE.Material).dispose();
      blob.geometry.dispose();
      (blob.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}

/** the context runs on the CPU (SwiftShader, llvmpipe and the like) */
function isSoftware(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|software|softpipe/i.test(name);
  } catch {
    return false;
  }
}
