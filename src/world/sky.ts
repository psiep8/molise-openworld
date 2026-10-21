import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export interface SkyRig {
  sunLight: THREE.DirectionalLight;
  sunDirection: THREE.Vector3;
  /** La cupola va tenuta centrata sulla camera, altrimenti si esce dal box. */
  dome: THREE.Mesh;
  update(target: THREE.Vector3): void;
}

/** Pomeriggio molisano: sole non troppo basso, luce calda, ombre leggibili. */
export function createSky(scene: THREE.Scene, elevation = 27, azimuth = 238): SkyRig {
  const sky = new Sky();
  sky.scale.setScalar(7000);
  sky.frustumCulled = false;
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 5;
  uniforms.rayleigh.value = 1.6;
  uniforms.mieCoefficient.value = 0.004;
  uniforms.mieDirectionalG.value = 0.82;

  const sunDirection = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - elevation),
    THREE.MathUtils.degToRad(azimuth),
  );
  uniforms.sunPosition.value.copy(sunDirection);
  scene.add(sky);

  const sunLight = new THREE.DirectionalLight(0xffeed2, 2.9);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -300;
  sunLight.shadow.camera.right = 300;
  sunLight.shadow.camera.top = 300;
  sunLight.shadow.camera.bottom = -300;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 1600;
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.9;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const hemi = new THREE.HemisphereLight(0xa8c8ee, 0x63583f, 0.75);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.22);
  scene.add(ambient);

  const update = (target: THREE.Vector3): void => {
    sunLight.target.position.copy(target);
    sunLight.position.copy(target).addScaledVector(sunDirection, 800);
    sunLight.target.updateMatrixWorld();
    sunLight.updateMatrixWorld();
  };

  return { sunLight, sunDirection, dome: sky, update };
}
