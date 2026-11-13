// The words of Settings → Modules (lib/modules.js), each written inside t() so that
// scripts/check-source-strings.mjs finds them: a key handed over in a variable is invisible to it
// and would quietly stay English. modules.js keeps the same English, which the settings search
// matches on; modules-copy.test.js holds the two together.
import { t } from './i18n.js'

export const moduleCopy = () => ({
  effort: [t('Effort'), t('Rate each set in RIR or RPE, and see in Stats how hard you really push.')],
  plates: [t('Plates and warm-ups'), t('The plates to load under every set, and warm-ups that build themselves.')],
  strength: [t('Strength levels'), t('Beginner to Elite for your main lifts, measured against your body weight.')],
  videos: [t('Form videos'), t('Film a set and watch it back right under the row.')],
  checkin: [t('Daily check-in'), t('A plain tap-in each day, or a photo that shows how you change.')],
  body: [t('Body'), t('Weigh-ins, measurements, progress photos and your weight goal.')],
  motivation: [t('Motivation'), t('Streaks, challenges, badges, recaps and your year in yuan-Gym.')],
  coach: [t('AI Coach'), t('Reviews your training and suggests changes. You still say yes or no.')],
  seasonal: [t('Seasonal themes'), t('Halloween, Christmas and the advent calendar. Spooky, festive, optional.')],
})

export const groupCopy = () => ({
  training: t('Training'),
  body: t('Body'),
  extras: t('Extras'),
})

export const presetCopy = () => ({
  training: [t('Just training'), t('Log, plan, progress. Nothing else on the screen.')],
  body: [t('Training and body'), t('Plus weigh-ins, measurements and progress photos.')],
  all: [t('Everything'), t('Streaks, the Coach, themes, the lot.')],
})
