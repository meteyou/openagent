import { registerPlugin } from '~/utils/pluginRegistry'
import voiceInputPlugin from './voice-input/index'

/**
 * Nuxt plugin: registers all frontend plugins at app startup.
 */
export default defineNuxtPlugin(() => {
  registerPlugin(voiceInputPlugin)
})
