import * as THREE from 'three'
import { buildBody } from './src/lib/anatomy-model.js'

const built = buildBody({ profile: {}, gender: 'male', half: 'all' })

const boxOf = obj => {
  const b = new THREE.Box3().setFromObject(obj)
  return {
    min: b.min.toArray().map(v => +v.toFixed(3)),
    max: b.max.toArray().map(v => +v.toFixed(3)),
  }
}

console.log('skin  ', boxOf(built.skin))
console.log('muscle', boxOf(built.muscles))
console.log('bones ', boxOf(built.bones))
console.log('total ', boxOf(built.group))
console.log('height prop', built.height)

console.log('\n--- skin children ---')
built.skin.children.forEach((c, i) => {
  const b = new THREE.Box3().setFromObject(c)
  console.log(i, c.geometry.type,
    'min', b.min.toArray().map(v => +v.toFixed(3)).join(','),
    'max', b.max.toArray().map(v => +v.toFixed(3)).join(','))
})

console.log('\n--- muscle groups ---')
for (const [id, meshes] of Object.entries(built.muscleMeshes)) {
  const b = new THREE.Box3()
  meshes.forEach(m => b.expandByObject(m))
  console.log(id.padEnd(13), meshes.length, 'meshes  y', b.min.y.toFixed(3), '->', b.max.y.toFixed(3),
    ' x', b.min.x.toFixed(3), '->', b.max.x.toFixed(3))
}
