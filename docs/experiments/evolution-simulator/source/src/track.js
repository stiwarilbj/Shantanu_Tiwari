import { speciesEditsAfter } from './engine/species-actions.js'
import { clamp, DT } from './engine/geometry.js'

export const TRACK_FIELDS = 7

export function prepareTrack(track) {
  track.eaten = new Map(track.events.filter(e => e.type === 'plant').map(e => [e.target, e.time]))
  track.changes = new Map()
  track.foodWebChanges = track.events.filter(event => event.type === 'food-web')
  track.speciesChanges = track.events.filter(event => event.type === 'species-edit')
  for (const event of track.events) {
    if (event.id == null) continue
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
  const row = track.width ?? opening.length * fields
  const blobs = opening.flatMap((blob, i) => {
    const p = index * row + i * fields, q = p + row
    const events = changes.get(blob.id)
    const introduced = events?.find(event => event.type === 'introduced')
    if (introduced && introduced.time > time + 1e-9) return []
    if (introduced) blob = introduced.blob
    const hasSample = Number.isFinite(frames[p])
    const prior = (offset, fallback) => hasSample ? frames[p + offset] : fallback
    let credits = 0, preyCredits = 0, state = prior(5, blob.state)
    let from = { time:hasSample ? aTime : introduced.time, x:prior(0, blob.x), y:prior(1, blob.y), energy:prior(3, blob.energy) }
    let to = { time:bTime, x:frames[q], y:frames[q+1], energy:frames[q+3] }
    const traits = events?.findLast(event => event.type === 'traits' && event.time <= time + 1e-9)?.traits
    const transfer = events?.findLast(event => event.type === 'transferred' && event.time <= time + 1e-9)
    let terminal
    if (events) for (const event of events) {
      if (event.type === 'traits') continue
      if (event.time > time + 1e-9) {
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
    const startAngle = prior(2, blob.angle)
    const startTime = hasSample ? aTime : introduced.time
    const delta = frames[q + 2] - startAngle
    const angle = startAngle + Math.atan2(Math.sin(delta), Math.cos(delta)) * (time-startTime)/(bTime-startTime || 1)
    return { ...blob, ...traits, species: transfer?.species ?? blob.species, x:blend('x'), y:blend('y'), angle, energy:Math.max(0,blend('energy')),
      ...(fields > TRACK_FIELDS && {
        foragingDecision: prior(TRACK_FIELDS, blob.foragingDecision),
        foragingSavings: prior(TRACK_FIELDS + 1, blob.foragingSavings),
      }),
      credits, preyCredits, state, alive: state !== 6, home: state === 5 }
  })
  let speciesEdits = track.speciesEdits
  for (const event of track.speciesChanges ?? []) {
    if (event.time > time + 1e-9) break
    speciesEdits = speciesEditsAfter(speciesEdits, { id: event.species, definition: event.edit })
  }
  const foodWeb = track.foodWebChanges?.findLast(event => event.time <= time + 1e-9)?.foodWeb ?? track.foodWeb
  return { day: track.day, time, duration: track.duration, stepSeconds, refugeWidth: track.final.refugeWidth, blobs,
    ...(foodWeb && { foodWeb }), ...(speciesEdits && { speciesEdits }), plants: track.plants.filter(p => (eaten.get(p.id) ?? Infinity) > time), events: track.events }
}
