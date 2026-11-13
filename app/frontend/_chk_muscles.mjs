import { MUSCLES, muscleGroupsOf } from './src/lib/muscles.js'
import { EXDB } from './src/lib/exercises-data.js'

const counts = {}
for (const m of MUSCLES) counts[m] = 0
for (const ex of EXDB) {
  for (const g of muscleGroupsOf(ex)) if (counts[g] != null) counts[g]++
}
console.log('肌群 | 动作数')
for (const m of MUSCLES) console.log(String(m).padEnd(14), counts[m])
const zero = MUSCLES.filter(m => counts[m] === 0)
console.log('\n无动作肌群:', zero.length ? zero.join(', ') : '无')
console.log('总动作数:', EXDB.length)
