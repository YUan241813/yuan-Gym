// Single source of truth for "the user's body sex" across the two stores that hold it:
//   • S.body        — the app-wide setting (drives exercise recommendations, figure choice, …)
//   • profile.sex   — the anatomy profile that reshapes the 3D model (BodyMap3D / BodyModel3D)
//
// They must stay in lockstep: the 3D figure follows profile.sex, while exercise recommendations
// follow S.body. Any control that changes the sex (Settings, the first-launch picker, the
// per-page switch on the muscle/3D page) should call setBodySex() so both move together and the
// model and the recommendations never disagree about "which sex".
import { useStore } from '../store/useStore.js'
import { updateProfile } from './anatomy-profile.js'

export function setBodySex(value) {
  const sex = value === 'female' ? 'female' : 'male'
  useStore.getState().update(s => { s.body = sex })
  updateProfile({ sex })
}
