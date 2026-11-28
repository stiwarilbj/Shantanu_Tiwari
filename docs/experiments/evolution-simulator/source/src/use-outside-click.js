import { watch } from 'vue'

export function useOutsideClick(open, contains, dismiss) {
  watch(open, (active, _, onCleanup) => {
    if (!active) return

    let press
    const controller = new AbortController()
    const options = { capture: true, signal: controller.signal }
    document.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return
      press = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        tolerance: event.pointerType === 'touch' ? 10 : 5,
        startedInside: contains(event.target),
        dragged: false,
      }
    }, options)
    document.addEventListener('pointermove', event => {
      if (!press || press.id !== event.pointerId) return
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > press.tolerance) press.dragged = true
    }, { ...options, passive: true })
    document.addEventListener('click', event => {
      // A canvas drag can still dispatch a click when it ends on the canvas.
      const ignore = event.detail > 0 && (press?.startedInside || press?.dragged)
      press = null
      if (!ignore && event.target instanceof Element && !contains(event.target)) dismiss()
    }, options)
    onCleanup(() => controller.abort())
  }, { immediate: true })
}
