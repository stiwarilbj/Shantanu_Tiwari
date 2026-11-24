import { clamp, DT } from './engine/geometry.js'

export const TRACK_FIELDS = 7

export function prepareTrack(track) {
  track.eaten = new Map(track.events.filter(e => e.type === 'plant').map(e => [e.target, e.time]))
  track.changes = new Map()
  for (const event of track.events) {
    if (!track.changes.has(event.id)) track.changes.set(event.id, [])
    track.changes.get(event.id).push(event)
  }
  return track
}

export function adjacentFrameTime({ stepSeconds = DT, stride, duration }, time, direction) {
  const interval = stepSeconds * stride
  const sample = time / interval
  const nearest = Math.round(sample)
  const position = Math.abs(time - nearest * interval) < 1e-8 ? nearest : sample
  const index = direction < 0 ? Math.ceil(position) - 1 : Math.floor(position) + 1
  return clamp(index * stride * stepSeconds, 0, duration)
}

export function trackFrame(track, time) {
  if (time >= track.duration - 1e-8) return track.final
  const { stepSeconds = DT, stride, opening, frames, changes, eaten, fields = TRACK_FIELDS } = track
  const interval = stepSeconds * stride
  const index = Math.floor(time / interval + 1e-9)
  const aTime = index * interval, bTime = Math.min(track.duration, aTime + interval)
  const row = opening.length * fields
  const blobs = opening.map((blob, i) => {
    const p = index * row + i * fields, q = p + row
    const events = changes.get(blob.id)
    let credits = 0, preyCredits = 0, state = frames[p + 5]
    let from = { time:aTime, x:frames[p], y:frames[p+1], energy:frames[p+3] }
    let to = { time:bTime, x:frames[q], y:frames[q+1], energy:frames[q+3] }
    const traits = events?.findLast(event => event.type === 'traits' && event.time <= time + 1e-9)?.traits
    let terminal
    if (events) for (const event of events) {
      if (event.type === 'traits') continue
      if (event.time > time) {
        if (event.time <= bTime && event.type!=='birth') to = { ...event, energy:event.beforeEnergy ?? event.energy }
        break
      }
      if (event.type === 'plant' || event.type === 'prey') credits++
      if (event.type === 'prey') preyCredits++
      if (event.type === 'death' || event.type === 'home') terminal = event
      if (event.time >= aTime && event.type!=='birth') from = event
    }
    const u = (time-from.time)/(to.time-from.time || 1)
    const blend = key => terminal ? terminal[key] : from[key]+(to[key]-from[key])*u
    if (terminal) state = terminal.type === 'death' ? 6 : 5
    const delta = frames[q + 2] - frames[p + 2]
    const angle = frames[p + 2] + Math.atan2(Math.sin(delta), Math.cos(delta)) * (time-aTime)/(bTime-aTime || 1)
    return { ...blob, ...traits, x:blend('x'), y:blend('y'), angle, energy:Math.max(0,blend('energy')),
      ...(fields > TRACK_FIELDS && {
        foragingDecision: frames[p + TRACK_FIELDS],
        foragingSavings: frames[p + TRACK_FIELDS + 1],
      }),
      credits, preyCredits, state, alive: state !== 6, home: state === 5 }
  })
  return { day: track.day, time, duration: track.duration, stepSeconds, refugeWidth: track.final.refugeWidth, blobs,
    plants: track.plants.filter(p => (eaten.get(p.id) ?? Infinity) > time), events: track.events }
}
