let database
const libraryStores = ['runs', 'runSummaries']
const historyStore = 'runHistory'
const archiveStores = [...libraryStores, historyStore]
const migrationBatchSize = 8
const savedHistories = new WeakMap()

function db() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('evolution-simulator', 3)
    let blocked = false
    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) request.result.createObjectStore('runs', { keyPath: 'id' })
      if (event.oldVersion < 2) request.result.createObjectStore('runSummaries', { keyPath: 'id' })
      request.result.createObjectStore(historyStore, { keyPath: ['runId', 'day', 'kind'] })
    }
    request.onblocked = () => {
      blocked = true
      reject(new Error('Close other Evolution Simulator tabs and reload to open the run library.'))
    }
    request.onsuccess = () => {
      const connection = request.result
      if (blocked) connection.close()
      else {
        connection.onversionchange = () => {
          connection.close()
          database = null
        }
        resolve(connection)
      }
    }
    request.onerror = () => reject(request.error)
  })
  return database
}

async function execute(stores, mode, action) {
  const connection = await db()
  return new Promise((resolve, reject) => {
    const tx = connection.transaction(stores, mode)
    tx.onabort = () => reject(tx.error)
    try {
      const result = action(tx)
      tx.oncomplete = () => resolve(result?.())
    } catch (error) {
      tx.abort()
      reject(error)
    }
  })
}

export function summarizeRun(run) {
  return {
    id: run.id,
    created: run.created,
    setup: run.setup,
    savedThrough: run.summaries.at(-1)?.day ?? 0,
    ruleVersions: run.revisions.map(({ day, setup }) => ({ day, setup: { version: setup.version } })),
  }
}

const historyRange = id => IDBKeyRange.bound([id, 0], [id, Infinity])

function rememberHistory(run, revision) {
  const { summaries, checkpoints } = run
  // The opening checkpoint stays the same object across snapshots of a run.
  if (checkpoints.length) savedHistories.set(checkpoints[0], { revision, summaries, checkpoints })
}

export const readRun = id => execute(['runs', historyStore], 'readonly', tx => {
  const request = tx.objectStore('runs').get(id)
  let history
  request.onsuccess = () => {
    if (request.result?.historyRevision) history = tx.objectStore(historyStore).getAll(historyRange(id))
  }
  return () => {
    if (!history) return request.result
    const { historyRevision, ...run } = request.result
    run.summaries = []
    run.checkpoints = []
    for (const { kind, value } of history.result) run[kind].push(value)
    rememberHistory(run, historyRevision)
    return run
  }
})

const libraryEntry = ({ historyRevision, ...entry }) => entry

export const readLibrary = () => execute(libraryStores, 'readonly', tx => {
  const summaries = tx.objectStore('runSummaries').getAll()
  const ids = tx.objectStore('runs').getAllKeys()
  return () => {
    const indexed = new Set(summaries.result.map(run => run.id))
    return { summaries: summaries.result.map(libraryEntry), missing: ids.result.filter(id => !indexed.has(id)) }
  }
})

// The schema upgrade leaves old runs alone. Index them in short transactions once
// the active run is ready, and read each record inside the transaction that indexes it.
export async function indexLegacyRuns(ids) {
  const indexed = []
  for (let start = 0; start < ids.length; start += migrationBatchSize) {
    await execute(libraryStores, 'readwrite', tx => {
      const runs = tx.objectStore('runs')
      const summaries = tx.objectStore('runSummaries')
      for (const id of ids.slice(start, start + migrationBatchSize)) {
        // A save in another tab may already have indexed or migrated this run.
        const request = summaries.get(id)
        request.onsuccess = () => {
          if (request.result) {
            indexed.push(libraryEntry(request.result))
            return
          }
          const legacy = runs.get(id)
          legacy.onsuccess = () => {
            if (!legacy.result) return
            const summary = summarizeRun(legacy.result)
            summaries.put(summary)
            indexed.push(summary)
          }
        }
      }
    })
  }
  return indexed
}

function isPrefix(previous, current) {
  return previous === current ||
    previous.length <= current.length && previous.every((row, index) => row === current[index])
}

function writeRuns(...runs) {
  return execute(archiveStores, 'readwrite', tx => {
    const records = tx.objectStore('runs')
    const catalog = tx.objectStore('runSummaries')
    const history = tx.objectStore(historyStore)
    const entries = runs.map(summarizeRun)
    const revisions = []
    for (const [index, run] of runs.entries()) {
      const { summaries, checkpoints, ...record } = run
      const request = catalog.get(run.id)
      request.onsuccess = () => {
        const storedRevision = request.result?.historyRevision
        const previous = savedHistories.get(checkpoints[0])
        // Only append to the exact history we read or last committed. A different
        // tab can have saved a divergent history under the same run ID.
        const append = previous && previous.revision === storedRevision &&
          isPrefix(previous.summaries, summaries) && isPrefix(previous.checkpoints, checkpoints)
        if (storedRevision && !append) history.delete(historyRange(run.id))
        const summaryStart = append ? previous.summaries.length : 0
        const checkpointStart = append ? previous.checkpoints.length : 0
        for (let i = summaryStart; i < summaries.length; i++) {
          const value = summaries[i]
          history.put({ runId: run.id, day: value.day, kind: 'summaries', value })
        }
        for (let i = checkpointStart; i < checkpoints.length; i++) {
          const value = checkpoints[i]
          history.put({ runId: run.id, day: value.day, kind: 'checkpoints', value })
        }
        const revision = append && summaryStart === summaries.length && checkpointStart === checkpoints.length
          ? storedRevision : crypto.randomUUID()
        revisions[index] = revision
        records.put({ ...record, historyRevision: revision })
        catalog.put({ ...entries[index], historyRevision: revision })
      }
    }
    return () => {
      runs.forEach((run, index) => rememberHistory(run, revisions[index]))
      return entries
    }
  })
}

export const saveRun = async run => (await writeRuns(run))[0]
export const saveRunPair = (left, right) => writeRuns(left, right)
export const deleteRun = id => execute(archiveStores, 'readwrite', tx => {
  for (const store of libraryStores) tx.objectStore(store).delete(id)
  tx.objectStore(historyStore).delete(historyRange(id))
})
