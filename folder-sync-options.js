// folder-sync-options.js
// The Folder sync section of Settings: which bookmark folders are mirrored, under which Trilium
// note, whether it is on, and how the last sync went. The syncing itself is in background.js.

const folderSyncEls = {
  enabled: document.getElementById("folderSyncEnabled"),
  parent: document.getElementById("folderSyncParent"),
  folders: document.getElementById("folderSyncFolders"),
  status: document.getElementById("folderSyncStatus")
}

// Every folder in Firefox with its depth, in Firefox's order, leaving out the invisible root.
function flattenFolders(nodes, depth, out) {
  for (const node of nodes) {
    if (node.url || node.type === "separator") continue
    out.push({ id: node.id, title: node.title || "Untitled folder", depth })
    flattenFolders(node.children || [], depth + 1, out)
  }
  return out
}

function showFolderSyncStatus(status) {
  if (!status) {
    folderSyncEls.status.textContent = "Not synced yet."
    return
  }
  const when = new Date(status.at).toLocaleString()
  folderSyncEls.status.textContent = `${when}: ${status.message}`
  folderSyncEls.status.className = status.ok ? "hint ok" : "hint err"
}

async function loadFolderSync() {
  const { folderSync = {}, folderSyncStatus } = await browser.storage.local.get(["folderSync", "folderSyncStatus"])
  folderSyncEls.enabled.checked = Boolean(folderSync.enabled)
  folderSyncEls.parent.value = folderSync.parentNoteId || ""
  const chosen = new Set(folderSync.folderIds || [])
  const [root] = await browser.bookmarks.getTree()
  folderSyncEls.folders.innerHTML = ""
  for (const folder of flattenFolders(root.children || [], 0, [])) {
    const row = document.createElement("label")
    row.className = "check"
    row.style.paddingLeft = `${folder.depth * 16}px`
    const box = document.createElement("input")
    box.type = "checkbox"
    box.value = folder.id
    box.checked = chosen.has(folder.id)
    row.appendChild(box)
    row.appendChild(document.createTextNode(folder.title))
    folderSyncEls.folders.appendChild(row)
  }
  showFolderSyncStatus(folderSyncStatus)
}

async function saveFolderSync() {
  const folderIds = [...folderSyncEls.folders.querySelectorAll("input:checked")].map((box) => box.value)
  const parentNoteId = folderSyncEls.parent.value.trim()
  if (folderSyncEls.enabled.checked && !parentNoteId) {
    showStatus("Choose the Trilium note the folders go under.", false)
    return
  }
  const { activeProfileId } = await loadProfiles()
  await browser.storage.local.set({
    folderSync: { enabled: folderSyncEls.enabled.checked, profileId: activeProfileId, parentNoteId, folderIds }
  })
  showStatus(`Folder sync saved: ${folderIds.length} folder${folderIds.length === 1 ? "" : "s"}.`, true)
}

async function syncFoldersNow() {
  folderSyncEls.status.textContent = "Syncing…"
  folderSyncEls.status.className = "hint"
  showFolderSyncStatus(await browser.runtime.sendMessage({ type: "folderSyncNow" }))
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.folderSyncStatus) showFolderSyncStatus(changes.folderSyncStatus.newValue)
})
document.getElementById("folderSyncSave").addEventListener("click", saveFolderSync)
document.getElementById("folderSyncNow").addEventListener("click", syncFoldersNow)

loadFolderSync()
