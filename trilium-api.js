// trilium-api.js
// Minimal wrapper around Trilium's ETAPI (https://github.com/zadam/trilium/wiki/ETAPI)
// Trimmed to only the methods this extension actually uses.

class TriliumClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl.replace(/\/+$/, "")
    this.token = token
  }

  async send(method, path, body, contentType = "application/json") {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": contentType,
        Authorization: this.token
      },
      body
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      const error = new Error(`Trilium API ${method} ${path} failed: ${res.status} ${text}`)
      error.status = res.status
      throw error
    }
    return res
  }

  async request(method, path, body) {
    const res = await this.send(method, path, body ? JSON.stringify(body) : undefined)
    if (res.status === 204) return null
    return res.json()
  }

  async testConnection() {
    return this.request("GET", "/etapi/app-info")
  }

  async createNote({ parentNoteId, title, type = "text", content = "", mime, notePosition }) {
    return this.request("POST", "/etapi/create-note", {
      parentNoteId,
      title,
      type,
      content,
      mime,
      notePosition
    })
  }

  async patchNote(noteId, fields) {
    return this.request("PATCH", `/etapi/notes/${encodeURIComponent(noteId)}`, fields)
  }

  async getNoteContent(noteId) {
    const res = await this.send("GET", `/etapi/notes/${encodeURIComponent(noteId)}/content`)
    return res.text()
  }

  async putNoteContent(noteId, content) {
    await this.send("PUT", `/etapi/notes/${encodeURIComponent(noteId)}/content`, content, "text/plain")
  }

  async getBranch(branchId) {
    return this.request("GET", `/etapi/branches/${encodeURIComponent(branchId)}`)
  }

  async createBranch({ noteId, parentNoteId, notePosition }) {
    return this.request("POST", "/etapi/branches", { noteId, parentNoteId, notePosition })
  }

  async patchBranch(branchId, fields) {
    return this.request("PATCH", `/etapi/branches/${encodeURIComponent(branchId)}`, fields)
  }

  // Pushes changed note positions under a parent to the open Trilium windows.
  async refreshNoteOrdering(parentNoteId) {
    return this.request("POST", `/etapi/refresh-note-ordering/${encodeURIComponent(parentNoteId)}`)
  }

  async deleteBranch(branchId) {
    return this.request("DELETE", `/etapi/branches/${encodeURIComponent(branchId)}`)
  }

  async createAttribute({ noteId, type, name, value, isInheritable = false }) {
    return this.request("POST", "/etapi/attributes", {
      noteId,
      type,
      name,
      value: value ?? "",
      isInheritable
    })
  }

  async getNote(noteId) {
    return this.request("GET", `/etapi/notes/${encodeURIComponent(noteId)}`)
  }

  // Deletes every clone of the note, and any child whose only parent it is.
  async deleteNote(noteId) {
    return this.request("DELETE", `/etapi/notes/${encodeURIComponent(noteId)}`)
  }

  async searchNotes(query) {
    const result = await this.request(
      "GET",
      `/etapi/notes?search=${encodeURIComponent(query)}&includeArchivedNotes=true`
    )
    return result.results || []
  }

  async findNoteByLabel(labelName) {
    const result = await this.request(
      "GET",
      `/etapi/notes?search=${encodeURIComponent(`#${labelName}`)}`
    )
    return (result.results && result.results[0]) || null
  }
}

if (typeof module !== "undefined") {
  module.exports = { TriliumClient }
}
