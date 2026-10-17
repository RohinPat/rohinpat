import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// A small studio for the exploded models: physically based rendering with
// ACES tone mapping, an image-based "softbox room" for reflections, one
// shadow-casting key light, a shadow-catcher floor, orbit controls. It
// animates each part along its explode vector, can isolate a part (the rest
// turn to ghosts), and reports where each part's label anchor lands on
// screen so the page can draw leader lines. It only renders while visible.

// dir moves with the explode; late only joins in near the end (and leaves
// first on the way back), for sub-assemblies that come apart last
export type Mover = { obj: THREE.Object3D; dir: THREE.Vector3; late?: THREE.Vector3; home?: THREE.Vector3 };
export type Part = { id: string; label: string; note: string; movers: Mover[]; anchor: THREE.Object3D };
export type Model = {
  root: THREE.Object3D;
  parts: Part[];
  view: { position: [number, number, number]; target: [number, number, number]; fov?: number; near?: number; far?: number; minDistance?: number; maxDistance?: number };
  background: string;
  floorY: number;
  shadowSize: number;
  update?: (dt: number, t: number) => void;
  /** pointer picking: the hit under the pointer on down/up */
  onPointer?: (hit: THREE.Intersection | null, kind: "down" | "up") => void;
  /** camera distance multiplier when fully exploded */
  explodeZoom?: number;
  /** how far the look-at point moves when fully exploded */
  explodeLift?: [number, number, number];
  /** how the explode amount maps per part (default: linear) */
  ease?: (e: number, index: number, count: number) => number;
};

export type LabelPoint = { id: string; x: number; y: number; behind: boolean };

export type Viewer = {
  setExplode: (e: number) => void;
  setSolo: (id: string | null) => void;
  setPaused: (p: boolean) => void;
  setAutoRotate: (on: boolean) => void;
  onLabels: (cb: ((pts: LabelPoint[], w: number, h: number) => void) | null) => void;
  orbitImpulse: () => number;
  dispose: () => void;
};

// A photo studio for reflections: a dark room with big softboxes overhead,
// strip lights either side and a warm bounce below. Polished metal reads as
// metal because it reflects contrast — bright bands against dark.
function studio() {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(20, 12, 20), new THREE.MeshBasicMaterial({ color: 0x2c2d30, side: THREE.BackSide }));
  room.position.y = 4;
  s.add(room);
  const light = (w: number, h: number, x: number, y: number, z: number, rx: number, ry: number, k: number, color = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    s.add(m);
  };
  light(8, 5, 0, 9.8, 0, Math.PI / 2, 0, 3.2); // overhead softbox
  light(1.2, 8, -9.8, 4, 0, 0, Math.PI / 2, 2.6); // left strip
  light(1.2, 8, 9.8, 4, 0, 0, -Math.PI / 2, 2.0); // right strip
  light(16, 6, 0, 6.5, -9.8, 0, 0, 1.25); // big softbox behind: what flat, upward-facing metal reflects
  light(6, 2, 0, 3, 9.8, 0, Math.PI, 0.8, 0xfff2dd); // front kicker
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0x80776a }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.9;
  s.add(floor);
  return s;
}

export function createViewer(container: HTMLElement, model: Model, opts: { interactive: boolean; preview: boolean; breathe?: boolean }): Viewer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.preview ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.outline = "none";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(model.background);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(studio(), 0.02).texture;
  scene.environment = env;

  const camera = new THREE.PerspectiveCamera(model.view.fov ?? 32, 1, model.view.near ?? 0.05, model.view.far ?? 2000);
  camera.position.set(...model.view.position);
  const target = new THREE.Vector3(...model.view.target);
  // tiles are small: stand back a little
  if (opts.preview) camera.position.sub(target).multiplyScalar(1.3).add(target);
  camera.lookAt(target);

  // key light + shadow catcher
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  const s = model.shadowSize;
  key.position.set(target.x + s * 0.6, target.y + s * 1.6, target.z + s * 0.8);
  key.target.position.copy(target);
  key.castShadow = true;
  key.shadow.mapSize.set(opts.preview ? 1024 : 2048, opts.preview ? 1024 : 2048);
  key.shadow.camera.left = -s;
  key.shadow.camera.right = s;
  key.shadow.camera.top = s;
  key.shadow.camera.bottom = -s;
  key.shadow.camera.near = 0.01;
  key.shadow.camera.far = s * 6;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 6;
  scene.add(key, key.target);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8170, 0.35));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(s * 8, s * 8), new THREE.ShadowMaterial({ opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = model.floorY;
  floor.receiveShadow = true;
  scene.add(floor);

  model.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    // glass doesn't cast a hard shadow
    const glass = ((m.material as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0.5;
    m.castShadow = !glass;
    m.receiveShadow = true;
  });
  scene.add(model.root);
  for (const p of model.parts) for (const m of p.movers) m.home = m.obj.position.clone();

  let controls: OrbitControls | null = null;
  if (opts.interactive) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = model.view.minDistance ?? 0.1;
    controls.maxDistance = model.view.maxDistance ?? 100;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();
  }
  // picking
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pick = (e: PointerEvent, kind: "down" | "up") => {
    if (!model.onPointer) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = kind === "down" ? ray.intersectObject(model.root, true)[0] ?? null : null;
    model.onPointer(hit, kind);
  };
  const onDown = (e: PointerEvent) => pick(e, "down");
  const onUp = (e: PointerEvent) => pick(e, "up");
  if (opts.interactive && model.onPointer) {
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
  }

  let auto = opts.preview;
  let autoAngle = 0;
  const startOffset = camera.position.clone().sub(target);

  // explode
  let want = 0;
  let cur = 0;
  let zoomApplied = 1;
  const liftApplied = new THREE.Vector3();
  // solo: other parts swap to a ghost material
  const ghost = new THREE.MeshBasicMaterial({ color: 0xcfc8b8, transparent: true, opacity: 0.07, depthWrite: false });
  let solo: string | null = null;
  const applySolo = () => {
    for (const p of model.parts) {
      const dim = solo !== null && p.id !== solo;
      p.movers.forEach((m) =>
        m.obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          if (dim) {
            if (!mesh.userData.mat) mesh.userData.mat = mesh.material;
            mesh.material = ghost;
            mesh.castShadow = false;
          } else if (mesh.userData.mat) {
            mesh.material = mesh.userData.mat;
            mesh.userData.mat = undefined;
            mesh.castShadow = ((mesh.material as THREE.MeshPhysicalMaterial).transmission ?? 0) <= 0.5;
          }
        }),
      );
    }
  };

  let labelCb: ((pts: LabelPoint[], w: number, h: number) => void) | null = null;
  let w = 0;
  let h = 0;
  const resize = () => {
    w = container.clientWidth;
    h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  let visible = true;
  let paused = false;
  let raf = 0;
  let last = performance.now();
  let t = 0;
  let impulse = 0;
  let lastAz = 0;
  const v = new THREE.Vector3();

  let skip = false;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    // tile previews run at half rate: cheaper, and nobody can tell
    if (opts.preview && (skip = !skip)) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    if (opts.breathe) want = 0.5 - 0.5 * Math.cos(t * 0.45);
    cur += (want - cur) * Math.min(1, dt * 6);
    const n = model.parts.length;
    model.parts.forEach((p, i) => {
      const e = model.ease ? model.ease(cur, i, n) : cur;
      const l = Math.max(0, Math.min(1, (cur - 0.55) / 0.4));
      const late = l * l * (3 - 2 * l);
      for (const m of p.movers) {
        m.obj.position.copy(m.home!).addScaledVector(m.dir, e);
        if (m.late) m.obj.position.addScaledVector(m.late, late);
      }
    });
    model.update?.(dt, t);
    // follow the model's centre as it comes apart
    if (model.explodeLift) {
      const want = new THREE.Vector3(...model.explodeLift).multiplyScalar(cur);
      const d = want.clone().sub(liftApplied);
      if (d.lengthSq() > 1e-10) {
        (controls ? controls.target : target).add(d);
        camera.position.add(d);
        liftApplied.copy(want);
      }
    }
    // ease the camera back as the model comes apart
    const zf = 1 + ((model.explodeZoom ?? 1) - 1) * cur;
    if (Math.abs(zf - zoomApplied) > 1e-4) {
      const off = camera.position.clone().sub(controls ? controls.target : target);
      camera.position.copy((controls ? controls.target : target).clone().add(off.multiplyScalar(zf / zoomApplied)));
      if (!controls) startOffset.multiplyScalar(zf / zoomApplied);
      zoomApplied = zf;
    }
    if (auto && !controls) {
      autoAngle += dt * 0.25;
      const r = Math.hypot(startOffset.x, startOffset.z);
      camera.position.set(target.x + Math.sin(autoAngle + Math.atan2(startOffset.x, startOffset.z)) * r, target.y + startOffset.y, target.z + Math.cos(autoAngle + Math.atan2(startOffset.x, startOffset.z)) * r);
      camera.lookAt(target);
    }
    if (controls) {
      controls.autoRotate = auto;
      controls.autoRotateSpeed = 0.6;
      controls.update();
      const az = controls.getAzimuthalAngle();
      impulse = az - lastAz;
      lastAz = az;
    }
    renderer.render(scene, camera);
    if (labelCb) {
      const pts: LabelPoint[] = model.parts.map((p) => {
        p.anchor.getWorldPosition(v);
        v.project(camera);
        return { id: p.id, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, behind: v.z > 1 };
      });
      labelCb(pts, w, h);
    }
  };
  const run = () => {
    cancelAnimationFrame(raf);
    if (visible && !paused && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  const io = new IntersectionObserver(([en]) => {
    visible = en.isIntersecting;
    run();
  });
  io.observe(container);
  document.addEventListener("visibilitychange", run);
  run();

  return {
    setExplode: (e) => {
      want = e;
    },
    setSolo: (id) => {
      solo = id;
      applySolo();
    },
    setPaused: (p) => {
      paused = p;
      run();
    },
    setAutoRotate: (on) => {
      auto = on;
    },
    onLabels: (cb) => {
      labelCb = cb;
    },
    orbitImpulse: () => impulse,
    dispose: () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", run);
      controls?.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mt) => {
          Object.values(mt).forEach((val) => (val as THREE.Texture)?.isTexture && (val as THREE.Texture).dispose());
          mt.dispose();
        });
      });
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
