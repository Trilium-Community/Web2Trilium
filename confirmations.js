// confirmations.js
// Which confirmation prompts the Web2Trilium page shows. Every prompt is on by
// default; storage holds only the ones switched off, as
//   confirmations: { [key]: false }

const CONFIRMATIONS = [
  { key: "saveFolder", label: "Saving a folder to Trilium and removing it from Firefox" },
  { key: "deleteFolder", label: "Deleting a folder from Firefox" },
  { key: "deleteBookmark", label: "Deleting a bookmark from Firefox" },
  { key: "deleteSelectedBookmarks", label: "Deleting selected bookmarks from Firefox" },
  { key: "deleteTriliumNote", label: "Deleting a note from Trilium" },
  { key: "bookmarkAndDeleteTriliumNote", label: "Bookmarking a Trilium link and deleting its note" },
  { key: "deleteSelectedTriliumNotes", label: "Deleting selected notes from Trilium" },
  { key: "bookmarkAndDeleteSelectedTriliumNotes", label: "Bookmarking selected Trilium links and deleting their notes" }
]

async function loadConfirmations() {
  const { confirmations } = await browser.storage.local.get("confirmations")
  return confirmations || {}
}

async function setConfirmation(key, enabled) {
  const confirmations = await loadConfirmations()
  if (enabled) delete confirmations[key]
  else confirmations[key] = false
  await browser.storage.local.set({ confirmations })
}

// Shows `message` unless the user has switched this prompt off in Settings.
async function confirmAction(key, message) {
  const confirmations = await loadConfirmations()
  if (confirmations[key] === false) return true
  return window.confirm(message)
}
