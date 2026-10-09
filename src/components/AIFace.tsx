import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import modelText from "./avatar/canonicalFaceModel.obj?raw";
import { nativeBridge } from "../services/nativeBridge";
import { AssistantState } from "../types/assistant";

type Features = {
  rms: number;
  low: number;
  mid: number;
  high: number;
  zeroCrossing: number;
  timestamp: number;
};

type Input = {
  state: AssistantState;
  micLevel: number;
  outputLevel: number;
  outputFeatures: Features | null;
};

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const damp = (a: number, b: number, dt: number, time: number) =>
  a + (b - a) * (1 - Math.exp(-dt / Math.max(0.001, time)));

const EYE_L = [33, 7, 163, 144, 145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157, 173];
const EYE_R = [263, 249, 390, 373, 374, 380, 381, 382, 362, 466, 388, 387, 386, 385, 384, 398];
const MOUTH = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 185, 40, 39, 37, 0, 267, 269, 270, 409];
const MOUTH_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 191, 80, 81, 82, 13, 312, 311, 310, 415];
const BROWS = [46, 53, 52, 65, 55, 70, 63, 105, 66, 107, 276, 283, 282, 295, 285, 300, 293, 334, 296, 336];

// The canonical face model is scaled by 0.182, which yields a head roughly
// 2.82 wide x 3.22 tall x 1.82 deep in world units. A fixed camera distance
// cannot frame this on both a narrow portrait phone and a wide desktop window:
// on portrait it crops the chin and temples, on desktop the head shrinks to a
// speck. These bounds drive a fit-to-view distance instead.
const FACE_HALF_WIDTH = 1.409;
const FACE_HALF_HEIGHT = 1.608;
const FACE_FOV = 30;
// Target fraction of the tighter viewport axis that the head should occupy.
const FACE_FRAME_FILL = 0.86;
// Fallback distance used before the first ResizeObserver measurement.
const FACE_CAMERA_Z = 6.98;

// Returns the camera distance that frames the whole head on whichever axis is
// tighter, so the face stays fully visible and correctly proportioned at every
// aspect ratio without clipping the chin or cutting off the temples.
const faceCameraDistance = (aspect: number): number => {
  const t = Math.tan(((FACE_FOV / 2) * Math.PI) / 180);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const byHeight = FACE_HALF_HEIGHT / (t * FACE_FRAME_FILL);
  const byWidth = FACE_HALF_WIDTH / (t * safeAspect * FACE_FRAME_FILL);
  return Math.max(byHeight, byWidth);
};

class AvatarEngine {
  host: HTMLElement;
  renderer: THREE.WebGLRenderer | null = null;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  root = new THREE.Group();

  face!: THREE.Mesh;
  hologram!: THREE.ShaderMaterial;
  wire!: THREE.LineSegments;
  particles!: THREE.Points;
  leftEye!: THREE.Group;
  rightEye!: THREE.Group;
  leftIris!: THREE.Mesh;
  rightIris!: THREE.Mesh;
  leftSocket!: THREE.LineLoop;
  rightSocket!: THREE.LineLoop;
  mouthOpening!: THREE.Mesh;
  upperLip!: THREE.Line;
  lowerLip!: THREE.Line;
  neck!: THREE.Mesh;

  positions!: Float32Array;
  base!: Float32Array;
  frame = 0;
  clock = new THREE.Clock();
  resizeObserver!: ResizeObserver;
  alive = false;
  time = 0;

  blink = 0;
  nextBlink = 2.7;
  gazeX = 0;
  gazeY = 0;
  targetGazeX = 0;
  targetGazeY = 0;
  nextGaze = 0.8;

  mouth = 0;
  mouthSpread = 0;
  energy = 0;
  headYaw = 0;
  headPitch = 0;

  input: Input = {
    state: "idle",
    micLevel: 0,
    outputLevel: 0,
    outputFeatures: null,
  };

  constructor(host: HTMLElement) {
    this.host = host;
  }

  start() {
    if (this.alive) return;

    try {
      this.renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      return;
    }

    this.alive = true;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);

    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, /Android/i.test(navigator.userAgent) ? 1.2 : 1.5)
    );
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, 0.04, FACE_CAMERA_Z);
    this.camera.lookAt(0, 0, 0);
    this.host.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0x1d5563, 1.15));
    const key = new THREE.DirectionalLight(0x5beeff, 2.6);
    key.position.set(2.5, 3.5, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fd8ff, 1.15);
    rim.position.set(-3.2, 1.4, -2.6);
    this.scene.add(rim);

    const parsed = this.parseObj(modelText);
    this.positions = parsed.vertices;
    this.base = parsed.vertices.slice();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(parsed.faces, 1));
    geometry.scale(0.182, 0.182, 0.182);
    geometry.translate(0, 0.02, 0.08);
    geometry.computeVertexNormals();

    const surfaceMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x48eaff,
      emissive: 0x0d5f73,
      emissiveIntensity: 1.35,
      roughness: 0.34,
      metalness: 0.08,
      transparent: true,
      // The previous 0.62 opacity with depthWrite disabled made the face read as
      // a faint haze on mobile. Raising the surface opacity is what actually
      // makes the anatomy legible; brightness alone was never the issue.
      opacity: 0.86,
      side: THREE.DoubleSide,
      depthWrite: true,
    });

    this.face = new THREE.Mesh(geometry, surfaceMaterial);
    this.face.renderOrder = 4;

    this.hologram = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uState: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uEnergy;
        uniform float uState;
        varying vec3 vNormal;
        varying vec3 vWorld;

        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float fresnel = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 2.4);
          float scan = smoothstep(0.15, 0.95, 0.5 + 0.5 * sin(vWorld.y * 24.0 - uTime * 2.4));
          float detail = 0.5 + 0.5 * sin(vWorld.x * 37.0 + vWorld.z * 29.0 + uTime * 0.3);
          float alpha = 0.018 + fresnel * 0.12 + scan * 0.035 + detail * 0.018 + uEnergy * 0.045 + uState * 0.015;
          gl_FragColor = vec4(0.10, 0.88, 1.0, clamp(alpha, 0.015, 0.24));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const hologramLayer = new THREE.Mesh(geometry, this.hologram);
    hologramLayer.renderOrder = 5;
    this.face.add(hologramLayer);

    this.wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: 0x6defff,
        transparent: true,
        // 0.045 was effectively invisible on a phone screen; this is what
        // produces the readable polygonal mesh following the face.
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.wire.renderOrder = 8;

    const pointGeometry = new THREE.BufferGeometry();
    const source = parsed.vertices;
    const points: number[] = [];
    for (let i = 0; i < source.length; i += 9) {
      points.push(source[i], source[i + 1], source[i + 2]);
    }
    pointGeometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    pointGeometry.scale(0.182, 0.182, 0.182);
    pointGeometry.translate(0, 0.02, 0.08);
    this.particles = new THREE.Points(
      pointGeometry,
      new THREE.PointsMaterial({
        color: 0x9df7ff,
        size: 0.018,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );

    const eyeMaterial = new THREE.MeshBasicMaterial({
      color: 0x03171d,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false,
    });
    const irisMaterial = new THREE.MeshBasicMaterial({
      color: 0x9df8ff,
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const socketMaterial = new THREE.LineBasicMaterial({
      color: 0x7befff,
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

    const eyeBall = new THREE.SphereGeometry(0.092, 16, 10);
    const iris = new THREE.SphereGeometry(0.043, 12, 8);

    const makeEye = (ids: number[], right: boolean) => {
      const center = this.point(ids);
      const group = new THREE.Group();

      const ball = new THREE.Mesh(eyeBall, eyeMaterial);
      const irisMesh = new THREE.Mesh(iris, irisMaterial);
      irisMesh.position.z = 0.035;
      ball.renderOrder = 20;
      irisMesh.renderOrder = 21;
      group.add(ball, irisMesh);

      const ringPoints = ids.map((id) => this.vertex(id));
      const ringGeometry = new THREE.BufferGeometry().setFromPoints(ringPoints);
      const ring = new THREE.LineLoop(ringGeometry, socketMaterial);

      group.position.set(center.x, center.y, center.z + 0.13);
      ring.renderOrder = 22;
      this.root.add(group, ring);

      return {
        group,
        iris: irisMesh,
        ring,
      };
    };

    const left = makeEye(EYE_L, false);
    const right = makeEye(EYE_R, true);
    this.leftEye = left.group;
    this.rightEye = right.group;
    this.leftIris = left.iris;
    this.rightIris = right.iris;
    this.leftSocket = left.ring;
    this.rightSocket = right.ring;

    const mouthCenter = this.point(MOUTH);
    const mouthPlane = new THREE.PlaneGeometry(0.34, 0.11);
    this.mouthOpening = new THREE.Mesh(
      mouthPlane,
      new THREE.MeshBasicMaterial({
        color: 0x00151b,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.mouthOpening.renderOrder = 24;
    this.mouthOpening.position.set(mouthCenter.x, mouthCenter.y, mouthCenter.z + 0.13);
    this.root.add(this.mouthOpening);

    const lipMaterial = new THREE.LineBasicMaterial({
      color: 0x8af5ff,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
    });

    const upperPoints = MOUTH.slice(0, 10).map((id) => this.vertex(id));
    const lowerPoints = MOUTH.slice(10).map((id) => this.vertex(id));
    this.upperLip = new THREE.Line(new THREE.BufferGeometry().setFromPoints(upperPoints), lipMaterial);
    this.lowerLip = new THREE.Line(new THREE.BufferGeometry().setFromPoints(lowerPoints), lipMaterial);
    this.upperLip.renderOrder = 25;
    this.lowerLip.renderOrder = 25;
    this.root.add(this.upperLip, this.lowerLip);

    const neckGeometry = new THREE.CylinderGeometry(0.44, 0.62, 1.22, 16, 4, true);
    neckGeometry.translate(0, -1.55, -0.12);
    this.neck = new THREE.Mesh(
      neckGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x18bcd1,
        transparent: true,
        opacity: 0.055,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    const neckWire = new THREE.LineSegments(
      new THREE.WireframeGeometry(neckGeometry),
      new THREE.LineBasicMaterial({
        color: 0x42dceb,
        transparent: true,
        opacity: 0.09,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );

    this.root.add(this.neck, neckWire, this.face, this.wire, this.particles);
    this.scene.add(this.root);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
    this.clock.start();
    this.animate();
  }

  parseObj(text: string) {
    const vertices: number[] = [];
    const faces: number[] = [];

    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("v ")) {
        const p = line.trim().split(/\s+/);
        vertices.push(Number(p[1]), Number(p[2]), Number(p[3]));
      } else if (line.startsWith("f ")) {
        const p = line.trim().split(/\s+/);
        if (p.length >= 4) {
          for (let i = 1; i <= 3; i++) {
            faces.push(Number(p[i].split("/")[0]) - 1);
          }
        }
      }
    }

    return {
      vertices: new Float32Array(vertices),
      faces: new Uint32Array(faces),
    };
  }

  vertex(id: number) {
    return new THREE.Vector3(
      this.positions[id * 3] * 0.182,
      this.positions[id * 3 + 1] * 0.182 + 0.02,
      this.positions[id * 3 + 2] * 0.182 + 0.08
    );
  }

  point(ids: number[]) {
    const p = new THREE.Vector3();
    for (const id of ids) p.add(this.vertex(id));
    return p.multiplyScalar(1 / ids.length);
  }

  update(input: Input) {
    this.input = input;
  }

  animate = () => {
    if (!this.alive || !this.renderer) return;

    this.frame = requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;

    // The new lifecycle states reuse the existing animation branches:
    // USER_SPEAKING animates like LISTENING (mic-driven), RESPONSE_READY
    // animates like THINKING. No avatar/animation redesign.
    const speaking = this.input.state === "speaking";
    const thinking = this.input.state === "thinking" || this.input.state === "response_ready";
    const listening = this.input.state === "listening" || this.input.state === "user_speaking";
    const features = this.input.outputFeatures;

    const audioRms = features?.rms ?? this.input.outputLevel;
    const spectralEnergy = features
      ? clamp(features.low * 0.55 + features.mid * 0.75 + features.high * 0.35)
      : this.input.outputLevel;

    const targetEnergy = speaking
      ? clamp(audioRms * 1.7 + spectralEnergy * 0.25)
      : listening
        ? clamp(this.input.micLevel * 0.55)
        : thinking
          ? 0.16
          : 0.06;

    this.energy = damp(this.energy, targetEnergy, dt, 0.09);

    this.headYaw = damp(
      this.headYaw,
      0.035 * Math.sin(this.time * 0.34) + (thinking ? 0.035 : listening ? -0.018 : 0),
      dt,
      0.32
    );
    this.headPitch = damp(
      this.headPitch,
      0.018 * Math.sin(this.time * 0.27 + 0.7),
      dt,
      0.35
    );

    this.root.rotation.y = this.headYaw;
    this.root.rotation.x = this.headPitch;
    this.root.position.y = Math.sin(this.time * 0.5) * 0.018;

    if (this.time >= this.nextBlink) {
      this.blink = 1;
      this.nextBlink = this.time + 3.0 + Math.random() * 4.2;
    } else {
      this.blink = Math.max(0, this.blink - dt * 10);
    }

    if (this.time >= this.nextGaze) {
      const range = thinking ? 0.24 : speaking ? 0.12 : listening ? 0.08 : 0.15;
      this.targetGazeX = (Math.random() * 2 - 1) * range;
      this.targetGazeY = (Math.random() * 2 - 1) * range * 0.45;
      this.nextGaze = this.time + (thinking ? 1.6 : 2.0) + Math.random() * 2.5;
    }

    this.gazeX = damp(this.gazeX, this.targetGazeX, dt, 0.08);
    this.gazeY = damp(this.gazeY, this.targetGazeY, dt, 0.08);

    const targetMouth = speaking
      ? clamp(
          Math.pow(
            clamp((audioRms * 1.8 + (features?.mid ?? 0) * 0.5) / 0.62),
            0.72
          )
        )
      : 0;

    const targetSpread = speaking
      ? clamp(((features?.mid ?? 0) - (features?.low ?? 0)) * 2.0, -0.4, 0.5)
      : 0;

    this.mouth = damp(this.mouth, targetMouth, dt, this.mouth < targetMouth ? 0.045 : 0.085);
    this.mouthSpread = damp(this.mouthSpread, targetSpread, dt, 0.055);

    this.positions.set(this.base);

    // Keep the underlying human mesh intact; only apply restrained facial
    // deformation for speaking and expression instead of a generic amplitude warp.
    if (speaking) {
      for (const id of MOUTH) {
        const i = id * 3;
        const side = this.positions[i] < 0 ? -1 : 1;
        this.positions[i] += side * this.mouthSpread * this.mouth * 0.18;
        this.positions[i + 1] += (this.positions[i + 1] < -4 ? -0.30 : 0.12) * this.mouth;
      }

      for (const id of MOUTH_INNER) {
        const i = id * 3;
        this.positions[i + 1] += (id === 13 || id === 82 || id === 312 ? 0.10 : -0.14) * this.mouth;
      }
    }

    const browLift =
      listening
        ? 0.07 + this.input.micLevel * 0.05
        : thinking
          ? -0.045
          : speaking
            ? this.energy * 0.08
            : 0.01;

    for (const id of BROWS) {
      this.positions[id * 3 + 1] += browLift;
    }

    // Real eyelid closure on the face mesh: compress the eye-region vertices
    // toward the eye center so blinking is not only an overlay animation.
    const lid = clamp(this.blink);
    const leftCenter = this.point(EYE_L);
    const rightCenter = this.point(EYE_R);

    for (const id of EYE_L) {
      const i = id * 3;
      const y = this.positions[i + 1] * 0.182 + 0.02;
      const targetY = leftCenter.y / 0.182 - 0.02;
      this.positions[i + 1] += (targetY - y) * lid * 0.32;
    }

    for (const id of EYE_R) {
      const i = id * 3;
      const y = this.positions[i + 1] * 0.182 + 0.02;
      const targetY = rightCenter.y / 0.182 - 0.02;
      this.positions[i + 1] += (targetY - y) * lid * 0.32;
    }

    const positionAttribute = this.face.geometry.getAttribute("position") as THREE.BufferAttribute;
    positionAttribute.needsUpdate = true;
    this.face.geometry.computeVertexNormals();

    const eyeScaleY = Math.max(0.08, 1 - lid * 0.92);
    this.leftEye.scale.y = eyeScaleY;
    this.rightEye.scale.y = eyeScaleY;

    const lookX = this.gazeX * 0.12;
    const lookY = this.gazeY * 0.07;

    this.leftIris.position.x = lookX;
    this.leftIris.position.y = lookY;
    this.rightIris.position.x = lookX;
    this.rightIris.position.y = lookY;

    this.leftSocket.scale.y = eyeScaleY;
    this.rightSocket.scale.y = eyeScaleY;

    const mouthWidth = 0.9 + Math.abs(this.mouthSpread) * 0.28;
    this.mouthOpening.scale.set(mouthWidth, Math.max(0.05, this.mouth * 1.65), 1);
    (this.mouthOpening.material as THREE.MeshBasicMaterial).opacity = 0.28 + this.mouth * 0.28;

    this.hologram.uniforms.uTime.value = this.time;
    this.hologram.uniforms.uEnergy.value = this.energy;
    this.hologram.uniforms.uState.value =
      speaking ? 1 : listening ? 0.55 : thinking ? 0.8 : 0.18;

    (this.wire.material as THREE.LineBasicMaterial).opacity =
      0.26 + this.energy * 0.16 + (thinking ? 0.08 : 0);

    (this.particles.material as THREE.PointsMaterial).opacity =
      0.16 + this.energy * 0.2;

    const irisGlow = 0.45 + this.energy * 0.45;
    (this.leftIris.material as THREE.MeshBasicMaterial).opacity = irisGlow;
    (this.rightIris.material as THREE.MeshBasicMaterial).opacity = irisGlow;

    this.renderer.render(this.scene, this.camera);
  };

  resize() {
    if (!this.renderer) return;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const aspect = width / height;
    this.camera.aspect = aspect;
    // Re-frame on every resize so the head is never cropped on portrait and
    // never shrinks to an unread speck on desktop.
    this.camera.position.set(0, 0.04, faceCameraDistance(aspect));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();

    this.scene.traverse((object) => {
      const item = object as THREE.Mesh | THREE.LineSegments | THREE.Line | THREE.Points;
      if (item.geometry) item.geometry.dispose();

      if (item.material) {
        const materials = Array.isArray(item.material) ? item.material : [item.material];
        materials.forEach((material) => material.dispose());
      }
    });

    this.renderer?.renderLists.dispose();
    this.renderer?.dispose();

    if (this.renderer?.domElement.parentElement === this.host) {
      this.host.removeChild(this.renderer.domElement);
    }

    this.scene.clear();
    this.renderer = null;
  }
}

export const AIFace: React.FC<{
  state: AssistantState;
  micLevel: number;
  outputLevel: number;
  className?: string;
}> = ({ state, micLevel, outputLevel, className = "" }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<AvatarEngine | null>(null);
  const inputRef = useRef<Input>({
    state,
    micLevel,
    outputLevel,
    outputFeatures: null,
  });

  inputRef.current = {
    ...inputRef.current,
    state,
    micLevel,
    outputLevel,
  };

  useEffect(() => {
    if (!hostRef.current) return;

    const engine = new AvatarEngine(hostRef.current);
    engineRef.current = engine;
    engine.start();

    let listener: { remove: () => Promise<void> } | null = null;
    let disposed = false;

    if (nativeBridge.isAvailable()) {
      void nativeBridge
        .addListener("outputAudioFeatures", (event: any) => {
          if (disposed) return;

          inputRef.current.outputFeatures = {
            rms: Number(event?.rms || 0),
            low: Number(event?.low || 0),
            mid: Number(event?.mid || 0),
            high: Number(event?.high || 0),
            zeroCrossing: Number(event?.zeroCrossing || 0),
            timestamp: Number(event?.timestamp || Date.now()),
          };

          engine.update(inputRef.current);
        })
        .then((value) => {
          listener = value;
        });
    }

    return () => {
      disposed = true;
      void listener?.remove().catch(() => {});
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.update(inputRef.current);
  }, [state, micLevel, outputLevel]);

  return (
    <div
      ref={hostRef}
      className={"relative flex h-full w-full items-center justify-center overflow-visible " + className}
      aria-label="JARVIS holographic human avatar"
    />
  );
};
