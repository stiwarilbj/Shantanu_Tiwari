let database
const archiveStores = ['runs', 'runSummaries']
const migrationBatchSize = 8

function db() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('evolution-simulator', 2)
    let blocked = false
    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) request.result.createObjectStore('runs', { keyPath: 'id' })
      request.result.createObjectStore('runSummaries', { keyPath: 'id' })
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

export const readRun = id => execute('runs', 'readonly', tx => {
  const request = tx.objectStore('runs').get(id)
  return () => request.result
})

export const readLibrary = () => execute(archiveStores, 'readonly', tx => {
  const summaries = tx.objectStore('runSummaries').getAll()
  const ids = tx.objectStore('runs').getAllKeys()
  return () => {
    const indexed = new Set(summaries.result.map(run => run.id))
    return { summaries: summaries.result, missing: ids.result.filter(id => !indexed.has(id)) }
  }
})

// The schema upgrade leaves old runs alone. Index them in short transactions once
// the active run is ready, and read each record inside the transaction that indexes it.
export async function indexLegacyRuns(ids) {
  const indexed = []
  for (let start = 0; start < ids.length; start += migrationBatchSize) {
    await execute(archiveStores, 'readwrite', tx => {
      const runs = tx.objectStore('runs')
      const summaries = tx.objectStore('runSummaries')
      for (const id of ids.slice(start, start + migrationBatchSize)) {
        const request = runs.get(id)
        request.onsuccess = () => {
          if (!request.result) return
          const summary = summarizeRun(request.result)
          summaries.put(summary)
          indexed.push(summary)
        }
      }
    })
  }
  return indexed
}

function writeRuns(...runs) {
  return execute(archiveStores, 'readwrite', tx => {
    const summaries = runs.map(summarizeRun)
    for (const run of runs) tx.objectStore('runs').put(run)
    for (const summary of summaries) tx.objectStore('runSummaries').put(summary)
    return () => summaries
  })
}

export const saveRun = async run => (await writeRuns(run))[0]
export const saveRunPair = (left, right) => writeRuns(left, right)
export const deleteRun = id => execute(archiveStores, 'readwrite', tx => {
  for (const store of archiveStores) tx.objectStore(store).delete(id)
})
