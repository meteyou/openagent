import type { OpenAgentFrontendPlugin } from '~/utils/pluginTypes'
import VoiceInput from './VoiceInput.vue'

export default {
  name: 'voice-input',
  slots: {
    'chat-input-actions': VoiceInput,
  },
} satisfies OpenAgentFrontendPlugin
