// folder-sync.js
// Mirrors chosen Firefox bookmark folders into Trilium, one way: each folder becomes a note
// under the chosen parent note, its text the folder's bookmarks as links, and each folder
// inside it a child note, in Firefox's order. Trilium is rewritten to match Firefox; a note
// is only ever touched if it carries the label below, so nothing else in Trilium changes.
//
// Storage shape:
//   folderSync: { enabled, profileId, parentNoteId, folderIds: [bookmark folder id] }
//   folderSyncStatus: { at, ok, message }

const FOLDER_LABEL = "web2triliumFolder"
// Waits this long after the last bookmark change before syncing, so a burst of edits is one sync.
const SYNC_DELAY_MS = 5000
const POSITION_STEP = 10

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// A folder note's text: its bookmarks as a list of links, or nothing for a folder without any.
function folderContent(folder) {
  const links = (folder.children || []).filter((child) => child.url && !child.url.startsWith("place:"))
  if (links.length === 0) return ""
  const items = links.map((link) => `<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.title || link.url)}</a></li>`)
  return `<ul>${items.join("")}</ul>`
}

function folderTitle(folder) {
  return (folder.title || "").trim() || "Untitled folder"
}

// Every folder to mirror, parents before children, each with the note it goes under: a chosen
// folder goes under the parent note, any other under its own parent folder's note. A chosen
// folder inside another chosen one is mirrored once, inside its parent.
function plannedFolders(trees, parentNoteId) {
  const chosen = new Set(trees.map((tree) => tree.id))
  const planned = []
  const visit = (folder, parent, position) => {
    planned.push({ id: folder.id, title: folderTitle(folder), content: folderContent(folder), parent, position })
    let index = 0
    for (const child of folder.children || []) {
      if (child.type === "folder" || (!child.url && child.children)) visit(child, { folderId: folder.id }, index++ * POSITION_STEP)
    }
  }
  const inside = (tree) => {
    const ids = new Set()
    const walk = (node) => (node.children || []).forEach((child) => { ids.add(child.id); walk(child) })
    walk(tree)
    return ids
  }
  const nested = new Set(trees.flatMap((tree) => [...inside(tree)].filter((id) => chosen.has(id))))
  trees.filter((tree) => !nested.has(tree.id)).forEach((tree, index) => visit(tree, { noteId: parentNoteId }, index * POSITION_STEP))
  return planned
}

function labelOf(note) {
  return (note.attributes || []).find((attribute) => attribute.type === "label" && attribute.name === FOLDER_LABEL)
}

// Makes Trilium match the chosen folders: creates, renames, rewrites, moves and orders their
// notes, and deletes the labelled notes whose folder is gone or no longer chosen. Gives back
// how many notes it created, changed and deleted.
async function syncFolders(client, trees, parentNoteId) {
  const planned = plannedFolders(trees, parentNoteId)
  const existing = await client.searchNotes(`#${FOLDER_LABEL}`)
  const noteOf = new Map()
  for (const note of existing) {
    const label = labelOf(note)
    if (label && !noteOf.has(label.value)) noteOf.set(label.value, note)
  }
  const report = { created: 0, changed: 0, deleted: 0 }
  const noteIdOf = new Map()
  const reordered = new Set()

  for (const folder of planned) {
    const parentId = folder.parent.noteId || noteIdOf.get(folder.parent.folderId)
    const note = noteOf.get(folder.id)
    if (!note) {
      const made = await client.createNote({ parentNoteId: parentId, title: folder.title, type: "text", content: folder.content, notePosition: folder.position })
      await client.createAttribute({ noteId: made.note.noteId, type: "label", name: FOLDER_LABEL, value: folder.id })
      noteIdOf.set(folder.id, made.note.noteId)
      report.created++
      continue
    }
    noteIdOf.set(folder.id, note.noteId)
    let changed = false
    if (note.title !== folder.title) {
      await client.patchNote(note.noteId, { title: folder.title })
      changed = true
    }
    if ((await client.getNoteContent(note.noteId)) !== folder.content) {
      await client.putNoteContent(note.noteId, folder.content)
      changed = true
    }
    const branches = await Promise.all((note.parentBranchIds || []).map((branchId) => client.getBranch(branchId)))
    const here = branches.find((branch) => branch.parentNoteId === parentId)
    if (!here) {
      await client.createBranch({ noteId: note.noteId, parentNoteId: parentId, notePosition: folder.position })
      for (const branch of branches) await client.deleteBranch(branch.branchId)
      changed = true
    } else if (here.notePosition !== folder.position) {
      await client.patchBranch(here.branchId, { notePosition: folder.position })
      reordered.add(parentId)
      changed = true
    }
    if (changed) report.changed++
  }

  for (const parentId of reordered) await client.refreshNoteOrdering(parentId)

  const kept = new Set(planned.map((folder) => folder.id))
  for (const [folderId, note] of noteOf) {
    if (kept.has(folderId)) continue
    try {
      await client.deleteNote(note.noteId)
    } catch (error) {
      // Already gone along with a deleted folder note it sat under.
      if (error.status !== 404) throw error
    }
    report.deleted++
  }
  return report
}

if (typeof module !== "undefined") {
  module.exports = { FOLDER_LABEL, SYNC_DELAY_MS, folderContent, plannedFolders, syncFolders }
}
