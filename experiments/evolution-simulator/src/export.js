import { METRICS } from './engine/stats.js'
import { HABITAT_DEFAULTS, INHERITANCE_DEFAULTS, REPRODUCTION_DEFAULTS, setupWithRuleDefaults,
  usesReproductionRules } from './engine/config.js'

function omitDefaults(values, defaults) {
  const entries = Object.entries(values ?? {}).filter(([key, value]) => value !== defaults[key])
  return entries.length ? Object.fromEntries(entries) : undefined
}

export function setupLink(setup) {
  let compact = setup
  if (usesReproductionRules(setup)) {
    compact = {
      ...omitDefaults(setup, HABITAT_DEFAULTS),
      reproduction: omitDefaults(setup.reproduction, REPRODUCTION_DEFAULTS),
      species: setup.species.map(item => {
        const mutationChance = omitDefaults(item.inheritance?.mutationChance, INHERITANCE_DEFAULTS.mutationChance)
        const mutationPattern = item.inheritance?.mutationPattern
        return { ...item, inheritance: omitDefaults({ mutationPattern, mutationChance }, INHERITANCE_DEFAULTS) }
      }),
    }
  }
  const bytes=new TextEncoder().encode(JSON.stringify(compact))
  if(bytes.length>1350) return null
  const token=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
  const link=location.origin+location.pathname+'#/setup/'+token
  return link.length<=1800 ? link : null
}

export function setupFromLink(hash) {
  if(!hash.startsWith('#/setup/')) return null
  const token=hash.slice(8)
  const bytes=Uint8Array.from(atob(token.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))
  const setup = JSON.parse(new TextDecoder().decode(bytes))
  // Share links omit defaults to keep common configurations within the URL limit.
  return setup && usesReproductionRules(setup) && Array.isArray(setup.species) &&
    setup.species.every(item => item && typeof item === 'object') ? setupWithRuleDefaults(setup) : setup
}

export function download(name, mime, content) {
  const url=URL.createObjectURL(new Blob([content],{type:mime}))
  const link=document.createElement('a')
  link.href=url
  link.download=name
  link.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}

export function csv(run, scope='all', start=1, end=1000) {
  const traits=METRICS.filter(m=>m.key!=='population')
  const fields=['n','mean','p25','p75','min','max','sd']
  const base=['opening','population','births','deaths','net','food','plants','plantsLeft','hunts']
  const causes=['Starvation','Missed home','Predation','Energy depletion']
  const headers=['run','seed','rule_version','day','scope','rule_start_day','fork_day',...base,...causes,...traits.flatMap(m=>fields.map(f=>m.key+'_'+f))]
  const out=[headers]
  for(const day of run.summaries.filter(s=>s.day>=start&&s.day<=end)) {
    const revision=run.revisions?.findLast(r=>r.day<=day.day)
    const rules=revision?.setup ?? run.setup
    for(const [id,row] of Object.entries(day.rows)) {
      if(scope!=='*'&&scope!==id) continue
      out.push([run.id,rules.seed,rules.version,day.day,id,revision?.day ?? 1,run.forkDay,...base.map(k=>row[k]),...causes.map(c=>row.causes[c]),
        ...traits.flatMap(m=>fields.map(f=>row[m.key]?.[f]))])
    }
  }
  return out.map(row=>row.map(v=>v==null?'':'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')
}
