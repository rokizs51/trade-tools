import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  filterCargoPositionsByLayer,
  generateCargoPositions,
  type CargoPosition,
  type ContainerSpecification,
  type PackingResult,
} from "./domain/load/index.js";

const MILLIMETERS_PER_METER = 1000;

export type ContainerDisplayMode = "TRANSPARENT" | "WIREFRAME" | "SOLID";

export type CameraPreset = "PERSPECTIVE" | "FRONT" | "BACK" | "LEFT" | "RIGHT" | "TOP";

export class LoadViewer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly controls: OrbitControls;
  private readonly contentGroup = new THREE.Group();
  private readonly resizeObserver: ResizeObserver;
  private containerMode: ContainerDisplayMode = "TRANSPARENT";
  private selectedLayer: number | "ALL" = "ALL";
  private lastResult: PackingResult | undefined;
  private lastContainer: ContainerSpecification | undefined;
  private animationFrameId: number | undefined;

  constructor(private readonly host: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xf6faf8, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.scene.add(this.contentGroup);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8aa39a, 1.7));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(8, 12, 10);
    this.scene.add(keyLight);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resetCamera();
    this.resize();
    this.start();
  }

  renderPacking(result: PackingResult, container: ContainerSpecification): void {
    this.lastResult = result;
    this.lastContainer = container;
    this.renderScene();
    this.setCameraPreset("PERSPECTIVE");
  }

  setContainerMode(mode: ContainerDisplayMode): void {
    this.containerMode = mode;
    this.renderScene();
  }

  setLayerFilter(layer: number | "ALL"): void {
    this.selectedLayer = layer;
    this.renderScene();
  }

  setCameraPreset(preset: CameraPreset): void {
    const container = this.lastContainer;

    if (!container) {
      this.setDefaultCamera();
      return;
    }

    const length = toMeters(container.internalLengthMm);
    const width = toMeters(container.internalWidthMm);
    const height = toMeters(container.internalHeightMm);
    const maxDimension = Math.max(length, width, height);
    const distance = maxDimension * 1.25;

    this.controls.target.set(0, height * 0.45, 0);

    if (preset === "FRONT") {
      this.camera.position.set(0, height * 0.45, distance);
    } else if (preset === "BACK") {
      this.camera.position.set(0, height * 0.45, -distance);
    } else if (preset === "LEFT") {
      this.camera.position.set(-distance, height * 0.45, 0);
    } else if (preset === "RIGHT") {
      this.camera.position.set(distance, height * 0.45, 0);
    } else if (preset === "TOP") {
      this.camera.position.set(0, distance, 0.001);
    } else {
      this.camera.position.set(maxDimension * 0.75, maxDimension * 0.45, maxDimension * 0.9);
    }

    this.camera.near = 0.1;
    this.camera.far = maxDimension * 8;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.renderFrame();
  }

  clear(): void {
    this.lastResult = undefined;
    this.lastContainer = undefined;
    this.selectedLayer = "ALL";
    this.clearGroup();
    this.setDefaultCamera();
  }

  resize(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;

    if (width === 0 || height === 0) {
      return;
    }

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.renderFrame();
  }

  resetCamera(container = this.lastContainer): void {
    this.lastContainer = container ?? this.lastContainer;
    this.setCameraPreset("PERSPECTIVE");
  }

  dispose(): void {
    this.resizeObserver.disconnect();

    if (this.animationFrameId !== undefined) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }

    this.clearGroup();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private renderScene(): void {
    this.clearGroup();

    if (!this.lastContainer) {
      return;
    }

    this.renderContainer(this.lastContainer);

    if (this.lastResult && this.lastResult.cartonsLoaded > 0) {
      this.renderCartons(this.lastResult, this.lastContainer);
    }
  }

  private setDefaultCamera(): void {
    this.controls.target.set(0, 1.2, 0);
    this.camera.position.set(9, 5.5, 10.8);
    this.camera.near = 0.1;
    this.camera.far = 1000;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.renderFrame();
  }

  private renderContainer(container: ContainerSpecification): void {
    const length = toMeters(container.internalLengthMm);
    const width = toMeters(container.internalWidthMm);
    const height = toMeters(container.internalHeightMm);
    const geometry = new THREE.BoxGeometry(length, height, width);
    const material = new THREE.MeshStandardMaterial({
      color: 0x4e8a8a,
      transparent: this.containerMode === "TRANSPARENT",
      opacity: this.containerMode === "TRANSPARENT" ? 0.12 : 0.38,
      roughness: 0.8,
      metalness: 0.05,
      side: THREE.DoubleSide,
      wireframe: this.containerMode === "WIREFRAME",
    });
    const walls = new THREE.Mesh(geometry, material);
    walls.position.set(0, height / 2, 0);
    this.contentGroup.add(walls);

    if (this.containerMode !== "WIREFRAME") {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x1f5f5b }),
      );
      edges.position.copy(walls.position);
      this.contentGroup.add(edges);
    }

    const floor = new THREE.GridHelper(Math.max(length, width), 12, 0x9fb9b0, 0xd5e0dc);
    floor.position.y = 0;
    this.contentGroup.add(floor);
  }

  private renderCartons(result: PackingResult, container: ContainerSpecification): void {
    const positions = filterCargoPositionsByLayer(generateCargoPositions(result), this.selectedLayer);

    if (positions.length === 0) {
      return;
    }

    const geometry = new THREE.BoxGeometry(
      toMeters(result.orientation.lengthMm),
      toMeters(result.orientation.heightMm),
      toMeters(result.orientation.widthMm),
    );
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0.02,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    for (const [index, position] of positions.entries()) {
      matrix.makeTranslation(...getCartonCenter(position, container));
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, color.set(position.layer % 2 === 0 ? 0xd99058 : 0x2f8f83));
    }

    mesh.instanceMatrix.needsUpdate = true;

    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    this.contentGroup.add(mesh);
  }

  private clearGroup(): void {
    for (const object of [...this.contentGroup.children]) {
      this.contentGroup.remove(object);
      disposeObject(object);
    }
  }

  private start(): void {
    const animate = (): void => {
      this.controls.update();
      this.renderFrame();
      this.animationFrameId = requestAnimationFrame(animate);
    };

    animate();
  }

  private renderFrame(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

function getCartonCenter(position: CargoPosition, container: ContainerSpecification): [number, number, number] {
  const containerLength = toMeters(container.internalLengthMm);
  const containerWidth = toMeters(container.internalWidthMm);
  const length = toMeters(position.lengthMm);
  const width = toMeters(position.widthMm);
  const height = toMeters(position.heightMm);

  return [
    toMeters(position.x) + (length / 2) - (containerLength / 2),
    toMeters(position.z) + (height / 2),
    toMeters(position.y) + (width / 2) - (containerWidth / 2),
  ];
}

function toMeters(valueMm: number): number {
  return valueMm / MILLIMETERS_PER_METER;
}

function disposeObject(object: THREE.Object3D): void {
  if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
    object.geometry.dispose();

    if (Array.isArray(object.material)) {
      for (const material of object.material) {
        material.dispose();
      }
    } else {
      object.material.dispose();
    }
  }

  for (const child of object.children) {
    disposeObject(child);
  }
}
