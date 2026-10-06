/**
 * AIOrb Component - Central Digital Earth Globe for JARVIS.
 * Built with Three.js / WebGL.
 * Features:
 * - Dark sophisticated Earth sphere
 * - Subtle green/cyan technical illumination (#00ffaa / #00d287)
 * - Thin latitude & longitude grid lines
 * - Subtle continental data points and city lights
 * - Multi-layer atmospheric rim glow
 * - Technical orbital rings with tracing data nodes
 * - Smooth state reactivity:
 *   IDLE: slow calm rotation
 *   LISTENING: reacts dynamically to microphone amplitude
 *   THINKING: accelerated rotation, vertical scanning ring sweep
 *   SPEAKING: pulses dynamically to JARVIS audio output amplitude
 * - Smooth mouse / touch rotation interaction
 */

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { AssistantState } from "../types/assistant";

interface AIOrbProps {
  state: AssistantState;
  micLevel: number;
  outputLevel: number;
  className?: string;
}

export const AIOrb: React.FC<AIOrbProps> = ({
  state,
  micLevel,
  outputLevel,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // References for animation loop
  const stateRef = useRef(state);
  stateRef.current = state;

  const micLevelRef = useRef(micLevel);
  micLevelRef.current = micLevel;

  const outputLevelRef = useRef(outputLevel);
  outputLevelRef.current = outputLevel;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let width = container.clientWidth || 360;
    let height = container.clientHeight || 360;

    // --- Scene Setup ---
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.z = 6.2;

    // Adapt rendering quality to the device instead of forcing desktop-quality
    // WebGL onto low-end Android WebViews.
    const isAndroid = /Android/i.test(navigator.userAgent);
    const cores = navigator.hardwareConcurrency || 4;
    const lowPowerDevice = isAndroid && cores <= 6;
    const renderPixelRatio = lowPowerDevice
      ? Math.min(window.devicePixelRatio || 1, 1.25)
      : Math.min(window.devicePixelRatio || 1, 1.75);

    const renderer = new THREE.WebGLRenderer({
      antialias: !lowPowerDevice,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(renderPixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    // Root group that holds the entire globe system
    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    // 1. Dark Core Sphere (Deep charcoal/black with subtle surface sheen)
    const sphereRadius = 2.0;
    const coreGeo = new THREE.SphereGeometry(sphereRadius, lowPowerDevice ? 32 : 48, lowPowerDevice ? 32 : 48);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x070b0e,
      roughness: 0.85,
      metalness: 0.25,
      emissive: 0x01130e,
      emissiveIntensity: 0.35,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    globeGroup.add(coreMesh);

    // 2. Latitude and Longitude Grid Lines (Restrained technical aesthetic)
    const gridMat = new THREE.LineBasicMaterial({
      color: 0x00d287,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
    });

    // Latitude rings
    const latGroup = new THREE.Group();
    const latAngles = [-60, -40, -20, 0, 20, 40, 60];
    latAngles.forEach((deg) => {
      const rad = (deg * Math.PI) / 180;
      const r = sphereRadius * Math.cos(rad) * 1.002;
      const y = sphereRadius * Math.sin(rad) * 1.002;
      const ringGeo = new THREE.BufferGeometry();
      const points: THREE.Vector3[] = [];
      const segments = lowPowerDevice ? 36 : 64;
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        points.push(new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)));
      }
      ringGeo.setFromPoints(points);
      const ringLine = new THREE.Line(ringGeo, gridMat);
      latGroup.add(ringLine);
    });
    globeGroup.add(latGroup);

    // Longitude meridians
    const lonGroup = new THREE.Group();
    const numMeridians = lowPowerDevice ? 8 : 12;
    for (let m = 0; m < numMeridians; m++) {
      const meridianGeo = new THREE.BufferGeometry();
      const points: THREE.Vector3[] = [];
      const segments = 64;
      const angle = (m / numMeridians) * Math.PI;
      for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        const x = sphereRadius * 1.002 * Math.sin(t) * Math.cos(angle);
        const y = sphereRadius * 1.002 * Math.cos(t);
        const z = sphereRadius * 1.002 * Math.sin(t) * Math.sin(angle);
        points.push(new THREE.Vector3(x, y, z));
      }
      meridianGeo.setFromPoints(points);
      const meridianLine = new THREE.Line(meridianGeo, gridMat);
      lonGroup.add(meridianLine);
    }
    globeGroup.add(lonGroup);

    // 3. Continental Data Points & City Lights
    // Distribute subtle points with continents-like density
    const numPoints = lowPowerDevice ? 700 : 1600;
    const positions = new Float32Array(numPoints * 3);
    const opacities = new Float32Array(numPoints);

    for (let i = 0; i < numPoints; i++) {
      // Golden spiral distribution
      const phi = Math.acos(1 - (2 * (i + 0.5)) / numPoints);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;

      // Continental density weight
      const lat = (0.5 - phi / Math.PI) * 180;
      const lon = ((theta % (2 * Math.PI)) / (2 * Math.PI)) * 360 - 180;

      // Mathematical pseudo-continental grouping
      const isLand =
        (lat > -10 && lat < 68 && lon > -130 && lon < -60) || // Americas
        (lat > -35 && lat < 15 && lon > -80 && lon < -35) ||  // South America
        (lat > 0 && lat < 70 && lon > -15 && lon < 50) ||     // Europe/Africa
        (lat > -35 && lat < 38 && lon > 10 && lon < 50) ||    // Africa
        (lat > 8 && lat < 70 && lon > 50 && lon < 145) ||     // Asia
        (lat > -42 && lat < -12 && lon > 115 && lon < 155);   // Australia

      const r = sphereRadius * (isLand ? 1.006 : 1.002);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.cos(phi);
      const z = r * Math.sin(phi) * Math.sin(theta);

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      opacities[i] = isLand ? (Math.random() > 0.4 ? 0.85 : 0.4) : 0.08;
    }

    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pointsGeo.setAttribute("alpha", new THREE.BufferAttribute(opacities, 1));

    const pointsMat = new THREE.PointsMaterial({
      color: 0x00ffaa,
      size: 0.035,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });
    const pointsMesh = new THREE.Points(pointsGeo, pointsMat);
    globeGroup.add(pointsMesh);

    // 4. Subtle Orbital Paths and Beacons
    const orbitGroup = new THREE.Group();
    const createOrbitRing = (radius: number, tiltX: number, tiltZ: number, color: number) => {
      const ringGroup = new THREE.Group();
      ringGroup.rotation.x = tiltX;
      ringGroup.rotation.z = tiltZ;

      const pathGeo = new THREE.BufferGeometry();
      const pts: THREE.Vector3[] = [];
      const segs = lowPowerDevice ? 54 : 90;
      for (let i = 0; i <= segs; i++) {
        const th = (i / segs) * Math.PI * 2;
        pts.push(new THREE.Vector3(radius * Math.cos(th), 0, radius * Math.sin(th)));
      }
      pathGeo.setFromPoints(pts);

      const pathMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
      });
      const orbitLine = new THREE.Line(pathGeo, pathMat);
      ringGroup.add(orbitLine);

      // Orbiting satellite/node
      const beaconGeo = new THREE.SphereGeometry(0.045, lowPowerDevice ? 8 : 12, lowPowerDevice ? 8 : 12);
      const beaconMat = new THREE.MeshBasicMaterial({
        color: 0x00ffaa,
        transparent: true,
        opacity: 0.9,
      });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      ringGroup.add(beacon);

      orbitGroup.add(ringGroup);
      return { ringGroup, beacon, radius };
    };

    const orbit1 = createOrbitRing(2.45, 0.4, 0.35, 0x00d287);
    const orbit2 = createOrbitRing(2.7, -0.55, -0.2, 0x00e5ff);
    globeGroup.add(orbitGroup);

    // 5. Scanning Plane / Ring for THINKING State
    const scanRingGeo = new THREE.RingGeometry(1.95, 2.05, lowPowerDevice ? 32 : 48);
    const scanRingMat = new THREE.MeshBasicMaterial({
      color: 0x00ffaa,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const scanRing = new THREE.Mesh(scanRingGeo, scanRingMat);
    scanRing.rotation.x = Math.PI / 2;
    globeGroup.add(scanRing);

    // 6. Atmospheric Glow Layer
    const atmoGeo = new THREE.SphereGeometry(sphereRadius * 1.15, lowPowerDevice ? 28 : 40, lowPowerDevice ? 28 : 40);
    const atmoMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        uniform float uIntensity;
        uniform vec3 uColor;
        void main() {
          float intensity = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.2);
          gl_FragColor = vec4(uColor, intensity * uIntensity);
        }
      `,
      uniforms: {
        uIntensity: { value: 0.45 },
        uColor: { value: new THREE.Color(0x00d287) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
    scene.add(atmoMesh);

    // 7. Subtle Ambient Floating Data Particles
    const dustCount = lowPowerDevice ? 40 : 80;
    const dustPositions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      const r = sphereRadius * (1.2 + Math.random() * 0.9);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      dustPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      dustPositions[i * 3 + 1] = r * Math.cos(phi);
      dustPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0x00ffaa,
      size: 0.025,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
    });
    const dustMesh = new THREE.Points(dustGeo, dustMat);
    scene.add(dustMesh);

    // Subtle Lighting
    const keyLight = new THREE.DirectionalLight(0x00ffaa, 1.2);
    keyLight.position.set(4, 3, 5);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x00d287, 0.6);
    rimLight.position.set(-4, -2, -3);
    scene.add(rimLight);

    const ambientLight = new THREE.AmbientLight(0x0a1412, 0.8);
    scene.add(ambientLight);

    // --- Interactive Mouse Dragging ---
    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;
    let targetRotationX = 0.15;
    let targetRotationY = 0;
    let autoRotationSpeed = 0.002;

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const deltaX = e.clientX - prevMouseX;
      const deltaY = e.clientY - prevMouseY;
      targetRotationY += deltaX * 0.006;
      targetRotationX += deltaY * 0.006;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isDragging = true;
        prevMouseX = e.touches[0].clientX;
        prevMouseY = e.touches[0].clientY;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging || e.touches.length !== 1) return;
      const deltaX = e.touches[0].clientX - prevMouseX;
      const deltaY = e.touches[0].clientY - prevMouseY;
      targetRotationY += deltaX * 0.006;
      targetRotationX += deltaY * 0.006;
      prevMouseX = e.touches[0].clientX;
      prevMouseY = e.touches[0].clientY;
    };

    const onTouchEnd = () => {
      isDragging = false;
    };

    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);

    // --- Animation Loop ---
    let animId: number;
    let scanY = -2.0;
    let scanDirection = 1;
    let currentScale = 1.0;
    let currentAtmoIntensity = 0.45;

    const clock = new THREE.Clock();
    let lastRenderTime = 0;
    const targetFrameMs = lowPowerDevice ? 33 : 16;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();

      const currentState = stateRef.current;
      const currentMic = micLevelRef.current;
      const currentOutput = outputLevelRef.current;

      // Base rotation speed adaptation based on state
      let desiredSpeed = 0.0018; // IDLE
      let targetAtmo = 0.45;
      let targetScale = 1.0;

      if (currentState === "listening") {
        desiredSpeed = 0.0028 + currentMic * 0.008;
        targetAtmo = 0.55 + currentMic * 0.45;
        targetScale = 1.0 + currentMic * 0.06;
      } else if (currentState === "thinking") {
        desiredSpeed = 0.007; // faster rotation
        targetAtmo = 0.65;
        targetScale = 1.02;
      } else if (currentState === "speaking") {
        desiredSpeed = 0.0035;
        targetAtmo = 0.55 + currentOutput * 0.5;
        targetScale = 1.0 + currentOutput * 0.08;
      }

      // Smooth interpolation for speed, scale, and atmosphere
      autoRotationSpeed += (desiredSpeed - autoRotationSpeed) * 0.08;
      targetRotationY += autoRotationSpeed;

      // Clamp vertical tilt
      targetRotationX = Math.max(-0.6, Math.min(0.6, targetRotationX));

      // Damped rotation lerp
      globeGroup.rotation.y += (targetRotationY - globeGroup.rotation.y) * 0.08;
      globeGroup.rotation.x += (targetRotationX - globeGroup.rotation.x) * 0.08;

      // Scale & Atmosphere pulse
      currentScale += (targetScale - currentScale) * 0.12;
      coreMesh.scale.setScalar(currentScale);
      pointsMesh.scale.setScalar(currentScale);
      latGroup.scale.setScalar(currentScale);
      lonGroup.scale.setScalar(currentScale);

      currentAtmoIntensity += (targetAtmo - currentAtmoIntensity) * 0.1;
      atmoMat.uniforms.uIntensity.value = currentAtmoIntensity;
      atmoMesh.scale.setScalar(currentScale);

      // Thinking State: Scanning Ring Sweep
      if (currentState === "thinking") {
        scanRingMat.opacity += (0.65 - scanRingMat.opacity) * 0.1;
        scanY += scanDirection * 0.045;
        if (scanY > 1.8) {
          scanDirection = -1;
        } else if (scanY < -1.8) {
          scanDirection = 1;
        }
        scanRing.position.y = scanY;
        const scanScale = Math.sqrt(Math.max(0, 4 - scanY * scanY)) * 0.5 + 0.1;
        scanRing.scale.set(scanScale, scanScale, 1);
      } else {
        scanRingMat.opacity += (0 - scanRingMat.opacity) * 0.1;
      }

      // Satellite orbital motion
      const t1 = elapsedTime * 0.6;
      orbit1.beacon.position.set(orbit1.radius * Math.cos(t1), 0, orbit1.radius * Math.sin(t1));

      const t2 = -elapsedTime * 0.45;
      orbit2.beacon.position.set(orbit2.radius * Math.cos(t2), 0, orbit2.radius * Math.sin(t2));

      // Subtle float for atmospheric particles
      dustMesh.rotation.y = elapsedTime * 0.02;
      dustMesh.rotation.x = Math.sin(elapsedTime * 0.05) * 0.05;

      const now = performance.now();
      if (now - lastRenderTime >= targetFrameMs) {
        lastRenderTime = now;
        renderer.render(scene, camera);
      }
    };

    animate();

    // Resize Handler using ResizeObserver to handle CSS-driven layout reflows dynamically
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const entry = entries[0];
      width = entry.contentRect.width || container.clientWidth || 360;
      height = entry.contentRect.height || container.clientHeight || 360;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(container);

    // Cleanup
    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      gridMat.dispose();
      pointsGeo.dispose();
      pointsMat.dispose();
      atmoGeo.dispose();
      atmoMat.dispose();
      dustGeo.dispose();
      dustMat.dispose();
      scanRingGeo.dispose();
      scanRingMat.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative flex items-center justify-center cursor-grab active:cursor-grabbing select-none ${className}`}
      style={{ touchAction: "none" }}
      aria-label="JARVIS Core Digital Globe"
    >
      {/* Subtle outer radial gradient glow behind the globe */}
      <div className="absolute inset-0 pointer-events-none rounded-full bg-[radial-gradient(circle_at_center,rgba(0,255,170,0.06)_0%,rgba(0,210,135,0.02)_45%,transparent_70%)]" />
    </div>
  );
};
