<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  saving?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'save'): void
}>()

const { t } = useI18n()

const content = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})
</script>

<template>
  <div class="flex flex-1 flex-col overflow-hidden min-h-0">
    <!-- Editor -->
    <textarea
      v-model="content"
      :placeholder="t('memory.editorPlaceholder')"
      spellcheck="false"
      class="w-full flex-1 min-h-0 resize-none rounded-xl border border-border bg-card p-4 font-mono text-sm text-foreground placeholder:text-muted-foreground leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background transition-colors overflow-y-auto"
    />

    <!-- Footer -->
    <div class="flex shrink-0 justify-end pt-3">
      <Button :disabled="saving" @click="$emit('save')">
        <span
          v-if="saving"
          class="mr-1.5 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground"
          aria-hidden="true"
        />
        {{ t('memory.save') }}
      </Button>
    </div>
  </div>
</template>
