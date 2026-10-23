import assert from 'node:assert/strict';
import { liftMask, erodeMask } from '../src/segmentation/lift';
import { SegmentationRegistry } from '../src/segmentation/registry';
import { computeSweepPoses } from '../src/segmentation/batch';
import type { CameraPose, DecodedMask } from '../src/segmentation/types';
import type { SplatGrid } from '../src/segmentation/splatIndex';

const matrix = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,1, 0,0,0,0]);
function pose(): CameraPose {
  return { viewMatrix:matrix, projectionMatrix:matrix, viewProjMatrix:matrix, invViewProjMatrix:matrix, fov:60, position:[0,0,0], width:8, height:8 };
}
function mask(): DecodedMask {
  return { label:'carving',score:0.9,width:8,height:8,data:new Uint8Array(64).fill(255),bbox:[0,0,8,8] };
}
function grid(points:number[]): SplatGrid {
  return { centers:new Float32Array(points), worldBounds:{min:[-4,-4,0],max:[4,4,4]} } as SplatGrid;
}
function selected(points:number[], scale=1): number[] {
  return [...(liftMask({grid:grid(points)},pose(),mask(),null,{sceneScale:scale})?.indices ?? [])];
}
// Two Gaussians at the same pixel: retain the visible one and its thin shell,
// reject the wall behind it. A distant surface at another pixel must survive.
assert.deepEqual(selected([0,0,1, 0,0,1.003, 0,0,2, 1,0,2]),[0,1,3]);
// World units must not change selection.
const points=[0,0,1, 0,0,1.003, 0,0,2, 1,0,2];
assert.deepEqual(selected(points.map(x=>x*100),100),[0,1,3]);
assert.deepEqual(selected(points.map(x=>x*0.01),0.01),[0,1,3]);
// Off-screen and behind-camera centers never enter a mask.
assert.deepEqual(selected([-1.01,0,1, 0,0,-1]),[]);
// Preserve fine edges by default; optional erosion removes exactly the border.
const full=mask();
assert.equal([...erodeMask(full,0)].filter(Boolean).length,64);
assert.equal([...erodeMask(full,1)].filter(Boolean).length,36);
assert.equal([...erodeMask(full,2)].filter(Boolean).length,16);
assert.throws(()=>liftMask({grid:grid([0,0,1])},pose(),{...mask(),width:7},null));
// Same label is insufficient to merge independent ornaments.
const registry=new SegmentationRegistry(new Float32Array(30).map((_,i)=>i/10));
const a=registry.upsert('carving',new Uint32Array([0,1,2]),0.9).object;
const b=registry.upsert('carving',new Uint32Array([5,6,7]),0.9).object;
assert.notEqual(a.id,b.id);
assert.equal(registry.size(),2);
assert.equal(registry.upsert('carving',new Uint32Array([5,6,7,8]),0.9).object.id,b.id);
assert.equal(registry.upsert('roof',new Uint32Array([5,6,7]),0.9).merged,false);
const sweep=computeSweepPoses(0.7);
assert.equal(sweep.length,16);
assert(sweep.every(p=>p.distance===0.7 && p.pitch>0));
assert.equal(new Set(sweep.map(p=>p.yaw)).size,8);
console.log('PASS: surface occlusion, slanted surfaces, scale invariance, frame bounds, mask erosion, instance merging, orbit poses');
