// background.js
browser.browserAction.onClicked.addListener(async () => {
  const url = browser.runtime.getURL("manage.html")
  const existing = await browser.tabs.query({ url })
  if (existing.length > 0) {
    await browser.tabs.update(existing[0].id, { active: true })
    await browser.windows.update(existing[0].windowId, { focused: true })
  } else {
    browser.tabs.create({ url })
  }
})

// ── Folder sync ──────────────────────────────────────────────────────────────

let folderSyncTimer = null
let folderSyncRunning = null
let folderSyncAgain = false

// The chosen folders' trees; a chosen folder deleted from Firefox is left out, so its notes go too.
async function chosenTrees(folderIds) {
  const trees = []
  for (const id of folderIds) {
    try {
      const [tree] = await browser.bookmarks.getSubTree(id)
      if (tree) trees.push(tree)
    } catch {
      continue
    }
  }
  return trees
}

async function runFolderSyncOnce() {
  const { folderSync } = await browser.storage.local.get("folderSync")
  if (!folderSync || !folderSync.enabled) return null
  if (!folderSync.parentNoteId) throw new Error("Choose the Trilium note the folders go under.")
  const { profiles, activeProfileId } = await loadProfiles()
  const profile = profiles.find((p) => p.id === folderSync.profileId) || profiles.find((p) => p.id === activeProfileId)
  if (!profile || !profile.token) throw new Error("Set the profile's server URL and ETAPI token first.")
  const client = new TriliumClient(profile.baseUrl, profile.token)
  return syncFolders(client, await chosenTrees(folderSync.folderIds || []), folderSync.parentNoteId)
}

// Syncs now, or once more after the sync already running, and records how it went.
async function runFolderSync() {
  if (folderSyncRunning) {
    folderSyncAgain = true
    return folderSyncRunning
  }
  folderSyncRunning = (async () => {
    let status
    try {
      const report = await runFolderSyncOnce()
      status = report
        ? { at: Date.now(), ok: true, message: `Synced: ${report.created} created, ${report.changed} changed, ${report.deleted} deleted.` }
        : { at: Date.now(), ok: true, message: "Folder sync is off." }
    } catch (error) {
      status = { at: Date.now(), ok: false, message: error.message }
    }
    await browser.storage.local.set({ folderSyncStatus: status })
    return status
  })()
  try {
    return await folderSyncRunning
  } finally {
    folderSyncRunning = null
    if (folderSyncAgain) {
      folderSyncAgain = false
      scheduleFolderSync()
    }
  }
}

function scheduleFolderSync() {
  clearTimeout(folderSyncTimer)
  folderSyncTimer = setTimeout(runFolderSync, SYNC_DELAY_MS)
}

for (const event of ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered", "onImportEnded"]) {
  if (browser.bookmarks[event]) browser.bookmarks[event].addListener(scheduleFolderSync)
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.folderSync) scheduleFolderSync()
})

browser.runtime.onMessage.addListener((message) => {
  if (message && message.type === "folderSyncNow") return runFolderSync()
  return undefined
})

browser.alarms.create("folderSync", { periodInMinutes: 30 })
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "folderSync") runFolderSync()
})

scheduleFolderSync()
