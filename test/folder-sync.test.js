// Folder sync against a Trilium kept in memory: what it creates, rewrites, moves and deletes.

const { test } = require("node:test")
const assert = require("node:assert/strict")

const { FOLDER_LABEL, folderContent, plannedFolders, syncFolders } = require("../folder-sync.js")

// A Trilium with notes, branches and labels, answering the calls folder sync makes.
function fakeTrilium() {
  const notes = new Map()
  const branches = new Map()
  let next = 1
  const id = (prefix) => `${prefix}${next++}`
  const gone = () => Object.assign(new Error("not found"), { status: 404 })
  const branch = (noteId, parentNoteId, notePosition = 0) => {
    const branchId = id("b")
    branches.set(branchId, { branchId, noteId, parentNoteId, notePosition })
    return branches.get(branchId)
  }
  const view = (note) => ({
    ...note,
    parentBranchIds: [...branches.values()].filter((b) => b.noteId === note.noteId).map((b) => b.branchId)
  })
  notes.set("root", { noteId: "root", title: "root", content: "", attributes: [] })
  const calls = []
  const client = {
    async searchNotes(query) {
      calls.push(["search", query])
      return [...notes.values()].filter((note) => note.attributes.some((a) => a.name === FOLDER_LABEL)).map(view)
    },
    async createNote({ parentNoteId, title, content, notePosition }) {
      calls.push(["create", title])
      const noteId = id("n")
      notes.set(noteId, { noteId, title, content, attributes: [] })
      return { note: view(notes.get(noteId)), branch: branch(noteId, parentNoteId, notePosition) }
    },
    async createAttribute({ noteId, type, name, value }) {
      notes.get(noteId).attributes.push({ type, name, value })
    },
    async patchNote(noteId, fields) {
      calls.push(["patch", noteId])
      Object.assign(notes.get(noteId), fields)
    },
    async getNoteContent(noteId) {
      return notes.get(noteId).content
    },
    async putNoteContent(noteId, content) {
      calls.push(["content", noteId])
      notes.get(noteId).content = content
    },
    async getBranch(branchId) {
      return branches.get(branchId)
    },
    async createBranch({ noteId, parentNoteId, notePosition }) {
      calls.push(["move", noteId])
      return branch(noteId, parentNoteId, notePosition)
    },
    async patchBranch(branchId, fields) {
      calls.push(["order", branchId])
      Object.assign(branches.get(branchId), fields)
    },
    async refreshNoteOrdering(parentNoteId) {
      calls.push(["refresh", parentNoteId])
    },
    async deleteBranch(branchId) {
      branches.delete(branchId)
    },
    async deleteNote(noteId) {
      if (!notes.has(noteId)) throw gone()
      calls.push(["delete", noteId])
      const drop = (target) => {
        notes.delete(target)
        for (const [branchId, b] of branches) {
          if (b.noteId === target) branches.delete(branchId)
        }
        for (const b of [...branches.values()]) {
          if (b.parentNoteId === target && ![...branches.values()].some((o) => o.noteId === b.noteId && o.parentNoteId !== target)) drop(b.noteId)
        }
      }
      drop(noteId)
    }
  }
  // Each mirrored folder as "parent title > title", for comparing the tree.
  const tree = () =>
    [...branches.values()]
      .filter((b) => notes.get(b.noteId)?.attributes.length)
      .sort((x, y) => x.notePosition - y.notePosition)
      .map((b) => `${notes.get(b.parentNoteId).title} > ${notes.get(b.noteId).title}`)
      .sort()
  return { client, notes, calls, tree }
}

const career = () => ({
  id: "career",
  title: " 1. Career",
  type: "folder",
  children: [
    { id: "jobs", title: "Job board", url: "https://jobs.example.org/?a=1&b=2", type: "bookmark" },
    { id: "sep", type: "separator" },
    { id: "portfolio", title: "Portfolio", type: "folder", children: [{ id: "cv", title: "<My CV>", url: "https://cv.example.org/", type: "bookmark" }] },
    { id: "empty", title: "", type: "folder", children: [] }
  ]
})

test("a folder's text lists its own bookmarks as escaped links, and is empty without any", () => {
  assert.equal(folderContent(career()), '<ul><li><a href="https://jobs.example.org/?a=1&amp;b=2">Job board</a></li></ul>')
  assert.equal(folderContent(career().children[2]), '<ul><li><a href="https://cv.example.org/">&lt;My CV&gt;</a></li></ul>')
  assert.equal(folderContent({ children: [{ url: "place:sort=8", title: "Recent" }] }), "")
})

test("plans each folder once, parents first, a chosen folder inside another left to its parent", () => {
  const tree = career()
  const planned = plannedFolders([tree, tree.children[2]], "root")
  assert.deepEqual(planned.map((f) => [f.id, f.title, f.parent]), [
    ["career", "1. Career", { noteId: "root" }],
    ["portfolio", "Portfolio", { folderId: "career" }],
    ["empty", "Untitled folder", { folderId: "career" }]
  ])
})

test("creates a labelled note per folder, then changes nothing when nothing changed", async () => {
  const trilium = fakeTrilium()
  assert.deepEqual(await syncFolders(trilium.client, [career()], "root"), { created: 3, changed: 0, deleted: 0 })
  assert.deepEqual(trilium.tree(), ["1. Career > Portfolio", "1. Career > Untitled folder", "root > 1. Career"])
  trilium.calls.length = 0
  assert.deepEqual(await syncFolders(trilium.client, [career()], "root"), { created: 0, changed: 0, deleted: 0 })
  assert.deepEqual(trilium.calls, [["search", `#${FOLDER_LABEL}`]])
})

test("renames, rewrites, moves and reorders notes as the folders change, and deletes the gone ones", async () => {
  const trilium = fakeTrilium()
  await syncFolders(trilium.client, [career()], "root")

  const changed = career()
  changed.title = "Career"
  changed.children[0].title = "Jobs"
  const portfolio = changed.children.splice(2, 1)[0]
  changed.children.splice(2, 1)
  changed.children.push({ id: "new", title: "Applications", type: "folder", children: [portfolio] })

  const report = await syncFolders(trilium.client, [changed], "root")

  assert.deepEqual(report, { created: 1, changed: 2, deleted: 1 })
  assert.deepEqual(trilium.tree(), ["Applications > Portfolio", "Career > Applications", "root > Career"])
  const careerNote = [...trilium.notes.values()].find((note) => note.title === "Career")
  assert.match(careerNote.content, />Jobs</)
})

test("puts a reordered folder note in Firefox's place and tells open Trilium windows", async () => {
  const trilium = fakeTrilium()
  const tree = career()
  await syncFolders(trilium.client, [tree], "root")
  tree.children.reverse()
  trilium.calls.length = 0
  assert.deepEqual(await syncFolders(trilium.client, [tree], "root"), { created: 0, changed: 2, deleted: 0 })
  assert.equal(trilium.calls.filter(([call]) => call === "order").length, 2)
  assert.equal(trilium.calls.filter(([call]) => call === "refresh").length, 1)
})

test("deletes every note of a folder no longer chosen, its children with it", async () => {
  const trilium = fakeTrilium()
  await syncFolders(trilium.client, [career()], "root")
  assert.deepEqual(await syncFolders(trilium.client, [], "root"), { created: 0, changed: 0, deleted: 3 })
  assert.deepEqual(trilium.tree(), [])
  assert.ok(trilium.notes.has("root"))
})
