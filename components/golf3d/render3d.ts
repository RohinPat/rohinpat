import * as THREE from "three";
import { CLUBS, at } from "@/components/offhours/golf/flight";
import type { CourseGame } from "@/components/offhours/golf/play";
import { buildHole3D, type Hole3D } from "./hole3d";
import { buildGolfer3D } from "./golfer3d";
import { createFx3D } from "./fx3d";
import type { View } from "./flyover";

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
  dispose: () => void;
  /** draw calls, triangles and device pixels of the last frame (for the perf test) */
  info: () => { calls: number; triangles: number; pixels: number; soft: boolean; fx: number };
};

export function createCourseRenderer(canvas: HTMLCanvasElement, opts: { maxPixels?: number; lowPower?: boolean; reduce?: boolean } = {}): CourseRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", alpha: false });
  // a software renderer (no usable GPU, or a test runner): the cheapest picture that still reads
  const soft = isSoftware(renderer.getContext());
  const lowPower = !!opts.lowPower || soft;
  const maxPixels = soft ? 3.5e5 : (opts.maxPixels ?? 2.4e6);
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
  sun.castShadow = true;
  sun.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 260;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  root.add(sun, sun.target);

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
  // the shot whose landings have been shown, and how many of them
  let fxShot: CourseGame["shot"] = null;
  let fxBounce = 0;
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
    hole = buildHole3D(g.hole, { tier: soft ? "soft" : lowPower ? "low" : "high" });
    holeOf = g.hole;
    root.add(hole.group);
    hidden.clear();
    dust.clear();
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
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
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
    // where the ball is: in the air, from the shot; else where it lies
    let bx = g.ball[0], by = BALL_R, bz = g.ball[1];
    let showBall = true;
    if (sh && g.phase === "fly") {
      const p = at(sh, g.shotT);
      bx = sh.ox + p[0];
      by = p[1] + BALL_R;
      bz = sh.oz + p[2];
    } else if (sh && g.phase === "rest" && !g.dropped) {
      const p = at(sh, sh.restT);
      bx = sh.ox + p[0];
      bz = sh.oz + p[2];
    }
    if (g.splash && (g.phase === "fly" || g.phase === "rest") && g.t - g.splash.t > 0) showBall = g.phase === "rest" && g.dropped && g.restT > 0.9;
    ball.visible = showBall;
    const dBall = Math.hypot(bx - c.x, by - c.y, bz - c.z);
    ball.position.set(bx, by, bz);
    ball.scale.setScalar(Math.max(1, (BALL_MIN_PX * dBall) / (c.F * BALL_R)));
    blob.visible = showBall;
    blob.position.set(bx, 0.005, bz);
    const lift = Math.max(0, by - BALL_R);
    blob.scale.setScalar(Math.max(0.035, BALL_R * 1.4 * ball.scale.x) * (1 + lift * 0.02));
    (blob.material as THREE.MeshBasicMaterial).opacity = 0.35 * Math.max(0.15, 1 - lift / 40);

    // the golfer stands at the ball until it is struck, then watches it go from where it was
    const gx = sh && (g.phase === "fly" || g.phase === "rest") ? sh.ox : g.ball[0];
    const gz = sh && (g.phase === "fly" || g.phase === "rest") ? sh.oz : g.ball[1];
    golfer.update([gx, 0.02, gz], g.yaw, club, g.pose);
    golfer.group.visible = Math.hypot(gx - c.x, gz - c.z) < 90;

    // the flag: waves in the wind, and grows far off so it can always be found
    if (hole) {
      const [px, pz] = g.hole.pin;
      const dFlag = Math.hypot(px - c.x, pz - c.z);
      hole.flag.scale.setScalar(Math.max(1, (FLAG_MIN_PX * dFlag) / (c.F * 2.4)));
      const wa = Math.atan2(g.wind[0], g.wind[1]);
      hole.cloth.rotation.y = -Math.PI / 2 + wa + Math.sin(g.t * 3.1) * 0.12;
      const pa = hole.cloth.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i);
        pa.setZ(i, Math.sin(g.t * 6 + x * 9) * 0.03 * x);
      }
      pa.needsUpdate = true;
      clearView(c.x, c.z, gx, gz);
    }

    // dust, sand and spray where the ball meets the ground
    if (sh !== fxShot) {
      fxShot = sh;
      fxBounce = 0;
      if (sh && g.phase === "fly") dust.strike(sh.ox, sh.oz, g.lie, g.yaw);
    }
    if (sh && (g.phase === "fly" || g.phase === "rest")) {
      const upTo = g.phase === "fly" ? g.shotT : sh.restT;
      while (fxBounce < sh.bounces.length && sh.bounces[fxBounce].t <= upTo) {
        const b = sh.bounces[fxBounce++];
        dust.land(sh.ox + b.x, sh.oz + b.z, b.surface, b.vy);
      }
    }
    dust.step(dt, eye.set(c.x, c.y, c.z), c.F);

    // the shadow camera follows what the camera looks at
    const fx = sh && g.phase === "fly" ? bx : (gx + c.tx) / 2;
    const fz = sh && g.phase === "fly" ? bz : (gz + c.tz) / 2;
    sun.target.position.set(fx, 0, fz);
    sun.position.set(fx + SUN.x * 120, SUN.y * 120, fz + SUN.z * 120);
    renderer.render(scene, camera);
  };

  return {
    render,
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, pixels: Math.round(size.w * size.h * size.pr * size.pr), soft, fx: dust.count() }),
    dispose: () => {
      hole?.dispose();
      golfer.dispose();
      dust.dispose();
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
