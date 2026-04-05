<script setup lang="ts">
import { computed } from 'vue'
import { SelectRoot, type SelectRootEmits, type SelectRootProps, type AcceptableValue } from 'reka-ui'
import { EMPTY_SENTINEL } from '~/lib/selectUtils'

const props = defineProps<SelectRootProps>()
const emits = defineEmits<SelectRootEmits>()

// Map empty string ↔ sentinel so reka-ui never sees value=""
const mappedProps = computed(() => {
  const { modelValue, defaultValue, ...rest } = props
  return {
    ...rest,
    modelValue: modelValue === '' ? EMPTY_SENTINEL : modelValue,
    defaultValue: defaultValue === '' ? EMPTY_SENTINEL : defaultValue,
  }
})

function onUpdate(value: AcceptableValue) {
  emits('update:modelValue', value === EMPTY_SENTINEL ? '' : value)
}
</script>

<template>
  <SelectRoot v-bind="mappedProps" @update:model-value="onUpdate">
    <slot />
  </SelectRoot>
</template>
