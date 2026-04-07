<template>
  <Dialog :open="open" @update:open="(v: boolean) => { if (!v) onCancel() }">
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ $t('voice.settings.title') }}</DialogTitle>
        <DialogDescription>{{ $t('voice.settings.description') }}</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-5" @submit.prevent="handleSave">
        <!-- ── Transcription Model ─────────────────────────────────────────── -->
        <div class="flex flex-col gap-1.5">
          <Label for="voice-transcription-model">{{ $t('voice.settings.transcriptionModel') }}</Label>
          <Select v-model="form.transcriptionModel">
            <SelectTrigger id="voice-transcription-model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="whisper">Whisper</SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">{{ $t('voice.settings.transcriptionModelHint') }}</p>
        </div>

        <!-- ── Whisper URL ─────────────────────────────────────────────────── -->
        <div class="flex flex-col gap-1.5">
          <Label for="voice-whisper-url">{{ $t('voice.settings.whisperUrl') }}</Label>
          <Input
            id="voice-whisper-url"
            v-model="form.whisperUrl"
            type="url"
            placeholder="https://whisper.jansohn.xyz/inference"
          />
          <p class="text-xs text-muted-foreground">{{ $t('voice.settings.whisperUrlHint') }}</p>
        </div>

        <!-- ── Pre-Processing toggle ───────────────────────────────────────── -->
        <div class="flex items-center justify-between rounded-lg border border-border px-4 py-3">
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-medium leading-none">{{ $t('voice.settings.rewriteEnabled') }}</span>
            <span class="text-xs text-muted-foreground">{{ $t('voice.settings.rewriteEnabledHint') }}</span>
          </div>
          <Switch
            :checked="form.rewriteEnabled"
            :aria-label="$t('voice.settings.rewriteEnabled')"
            @update:checked="(v: boolean) => (form.rewriteEnabled = v)"
          />
        </div>

        <!-- ── Ollama sub-section (shown only when rewrite is enabled) ─────── -->
        <Transition
          enter-active-class="transition-all duration-200 ease-out overflow-hidden"
          enter-from-class="opacity-0 max-h-0"
          enter-to-class="opacity-100 max-h-[800px]"
          leave-active-class="transition-all duration-150 ease-in overflow-hidden"
          leave-from-class="opacity-100 max-h-[800px]"
          leave-to-class="opacity-0 max-h-0"
        >
          <div v-if="form.rewriteEnabled" class="flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4">
            <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {{ $t('voice.settings.ollamaSection') }}
            </p>

            <!-- Ollama URL -->
            <div class="flex flex-col gap-1.5">
              <Label for="voice-ollama-url">{{ $t('voice.settings.ollamaUrl') }}</Label>
              <Input
                id="voice-ollama-url"
                v-model="form.ollamaUrl"
                type="url"
                placeholder="http://192.168.10.222:11434"
              />
            </div>

            <!-- Ollama Model -->
            <div class="flex flex-col gap-1.5">
              <Label for="voice-ollama-model">{{ $t('voice.settings.ollamaModel') }}</Label>
              <Input
                id="voice-ollama-model"
                v-model="form.ollamaModel"
                type="text"
                placeholder="qwen3:32b"
              />
            </div>

            <!-- Rewrite Prompt -->
            <div class="flex flex-col gap-1.5">
              <Label for="voice-rewrite-prompt">{{ $t('voice.settings.rewritePrompt') }}</Label>
              <textarea
                id="voice-rewrite-prompt"
                v-model="form.rewritePrompt"
                rows="8"
                class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono resize-y"
                :placeholder="$t('voice.settings.rewritePromptPlaceholder')"
              />
              <p class="text-xs text-muted-foreground">{{ $t('voice.settings.rewritePromptHint') }}</p>
            </div>
          </div>
        </Transition>

        <DialogFooter>
          <Button type="button" variant="outline" @click="onReset">
            {{ $t('voice.settings.reset') }}
          </Button>
          <div class="flex-1" />
          <Button type="button" variant="outline" @click="onCancel">
            {{ $t('common.cancel') }}
          </Button>
          <Button type="submit">
            {{ $t('common.save') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { useVoicePluginSettings } from '~/composables/useVoicePluginSettings'
import type { VoicePluginSettings } from '~/composables/useVoicePluginSettings'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { settings, saveSettings, getDefaults } = useVoicePluginSettings()

// Local form state — cloned from current settings when dialog opens
const form = reactive<VoicePluginSettings & { transcriptionModel: string }>({
  transcriptionModel: 'whisper',
  whisperUrl: settings.value.whisperUrl,
  rewriteEnabled: settings.value.rewriteEnabled,
  ollamaUrl: settings.value.ollamaUrl,
  ollamaModel: settings.value.ollamaModel,
  rewritePrompt: settings.value.rewritePrompt,
})

// Sync form from settings whenever the dialog opens
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      form.transcriptionModel = 'whisper'
      form.whisperUrl = settings.value.whisperUrl
      form.rewriteEnabled = settings.value.rewriteEnabled
      form.ollamaUrl = settings.value.ollamaUrl
      form.ollamaModel = settings.value.ollamaModel
      form.rewritePrompt = settings.value.rewritePrompt
    }
  },
)

function handleSave() {
  saveSettings({
    whisperUrl: form.whisperUrl.trim() || getDefaults().whisperUrl,
    rewriteEnabled: form.rewriteEnabled,
    ollamaUrl: form.ollamaUrl.trim() || getDefaults().ollamaUrl,
    ollamaModel: form.ollamaModel.trim() || getDefaults().ollamaModel,
    rewritePrompt: form.rewritePrompt.trim() || getDefaults().rewritePrompt,
  })
  emit('close')
}

function onCancel() {
  emit('close')
}

function onReset() {
  const d = getDefaults()
  form.transcriptionModel = 'whisper'
  form.whisperUrl = d.whisperUrl
  form.rewriteEnabled = d.rewriteEnabled
  form.ollamaUrl = d.ollamaUrl
  form.ollamaModel = d.ollamaModel
  form.rewritePrompt = d.rewritePrompt
}
</script>
