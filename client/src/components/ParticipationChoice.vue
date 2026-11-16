<script setup>
import { useId } from 'vue';

// Contribute (speaks in rooms) or Read-only (reads, never posts). Shared by the welcome sheet,
// the AI card and the rail menu so the two words always mean the same thing.
defineProps({
  modelValue: { type: String, default: 'contribute' },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const name = `participation-${useId()}`;
</script>

<template>
  <div class="choice-grid" role="radiogroup" aria-label="How it takes part">
    <label class="choice">
      <input
        type="radio"
        :name="name"
        value="contribute"
        :checked="modelValue === 'contribute'"
        :disabled="disabled"
        @change="emit('update:modelValue', 'contribute')"
      />
      <span class="toggle-text">
        Contribute
        <small>Reads the rooms and speaks in them, under its own name.</small>
      </span>
    </label>
    <label class="choice">
      <input
        type="radio"
        :name="name"
        value="readonly"
        :checked="modelValue === 'readonly'"
        :disabled="disabled"
        @change="emit('update:modelValue', 'readonly')"
      />
      <span class="toggle-text">
        Read-only
        <small>Reads the rooms. Never posts.</small>
      </span>
    </label>
  </div>
</template>
