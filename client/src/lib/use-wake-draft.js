import { reactive, watch } from 'vue';

/**
 * Local wake form that ignores background inhabitant refreshes while dirty.
 */
export function useWakeDraft(inhabitantSource) {
  const draft = reactive({
    wakeUrl: '',
    wakeSecret: '',
    authHeader: '',
    bearer: '',
    dirty: false,
    hydratedFor: '',
  });

  function read() {
    const ai = inhabitantSource.value || inhabitantSource;
    return ai || {};
  }

  function hydrate(force = false) {
    const ai = read();
    if (!ai.id) return;
    if (!force && draft.dirty && draft.hydratedFor === ai.id) return;
    draft.wakeUrl = ai.wakeUrl || '';
    draft.authHeader = ai.wakeAuthHeader || '';
    draft.hydratedFor = ai.id;
    draft.dirty = false;
  }

  watch(() => read().id, () => hydrate(true), { immediate: true });
  watch(
    () => [read().wakeUrl, read().hasWakeUrl, read().wakeAuthHeader],
    () => hydrate(false)
  );

  function markDirty() {
    draft.dirty = true;
  }

  function saved() {
    draft.dirty = false;
    draft.wakeSecret = '';
    draft.bearer = '';
  }

  return { draft, markDirty, saved, hydrate };
}
