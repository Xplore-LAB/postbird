// Persistent material-collection tracking for campus and administrative mail.

import fsp from "node:fs/promises";
import path from "node:path";

const STATUSES = new Set(["pending", "partial", "complete", "exempt"]);

function cleanId(value) {
  const id = String(value ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) {
    throw new Error("collectionId must be 1-80 characters using only letters, numbers, _ or -");
  }
  return id;
}

function storePath(storeDir, collectionId) {
  return path.join(storeDir, `${cleanId(collectionId)}.json`);
}

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`cannot read collection ledger ${file}: ${error.message}`);
  }
}

async function saveJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fsp.rename(temp, file);
}

function normalizeParticipants(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("participants must contain at least one person");
  const seen = new Set();
  return rows.map((row, index) => {
    const email = String(row?.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) throw new Error(`participant #${index + 1} needs a valid email`);
    if (seen.has(email)) throw new Error(`duplicate participant email: ${email}`);
    seen.add(email);
    return { name: String(row?.name ?? "").trim(), email };
  });
}

function discoverPeople(messages) {
  const people = new Map();
  for (const message of messages) {
    const email = String(message.from?.address ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    const current = people.get(email);
    const candidateName = String(message.from?.name ?? "").trim();
    if (!current) {
      people.set(email, { name: candidateName, email });
    } else if (!current.name && candidateName) {
      current.name = candidateName;
    }
  }
  return [...people.values()];
}

function itemSpec(raw) {
  const value = String(raw ?? "").trim();
  const aliases = value.split("|").map((part) => part.trim().toLowerCase()).filter(Boolean);
  return { name: aliases[0] ?? value, aliases };
}

function messageEvidence(message) {
  return `${message.subject ?? ""} ${message.snippet ?? ""} ${(message.attachments ?? []).map((a) => a.filename).join(" ")}`.toLowerCase();
}

function summarize(ledger) {
  const counts = { pending: 0, partial: 0, complete: 0, exempt: 0 };
  for (const participant of ledger.participants) counts[participant.status]++;
  return {
    ...ledger,
    counts,
    totalParticipants: ledger.participants.length,
    needsReminder: ledger.participants.filter((participant) => participant.status === "pending" || participant.status === "partial"),
    completed: ledger.participants.filter((participant) => participant.status === "complete"),
    resubmissions: ledger.participants.filter((participant) => participant.messageCount > 1),
    unmatchedSubmissions: ledger.unmatchedSubmissions ?? []
  };
}

/** Scan indexed email against an expected participant and material list. */
export async function scanCollection({
  messages, storeDir, collectionId, title, subjectKeyword = "", participants,
  requiredItems = [], daysBack = 90, participantMode = "roster", now = new Date()
}) {
  const file = storePath(storeDir, collectionId);
  const previous = await readJson(file);
  const specs = requiredItems.map(itemSpec).filter((item) => item.aliases.length > 0);
  const cutoff = now.getTime() - Math.max(daysBack, 1) * 86_400_000;
  const subjectNeedle = String(subjectKeyword).trim().toLowerCase();
  const eligible = messages.filter((message) => {
    if (new Date(message.date ?? 0).getTime() < cutoff) return false;
    if (subjectNeedle && !String(message.subject ?? "").toLowerCase().includes(subjectNeedle)) return false;
    return true;
  });
  const mode = participantMode === "discover" ? "discover" : "roster";
  if (mode === "discover" && !subjectNeedle) {
    throw new Error("subjectKeyword is required when participantMode=discover so unrelated inbox senders are not collected");
  }
  const people = mode === "discover" ? discoverPeople(eligible) : normalizeParticipants(participants);
  if (people.length === 0) {
    throw new Error(mode === "discover"
      ? `no participant mail matched subjectKeyword: ${subjectKeyword}`
      : "participants must contain at least one person");
  }
  const peopleEmails = new Set(people.map((person) => person.email));
  const oldByEmail = new Map((previous?.participants ?? []).map((person) => [person.email, person]));
  const scanned = people.map((person) => {
    const matched = eligible.filter((message) => String(message.from?.address ?? "").trim().toLowerCase() === person.email);
    const evidenceText = matched.map(messageEvidence).join(" ");
    const receivedItems = specs.filter((spec) => spec.aliases.some((alias) => evidenceText.includes(alias))).map((spec) => spec.name);
    const missingItems = specs.filter((spec) => !receivedItems.includes(spec.name)).map((spec) => spec.name);
    let status = matched.length === 0 ? "pending" : missingItems.length === 0 ? "complete" : "partial";
    const old = oldByEmail.get(person.email);
    if (old?.manualStatus) status = old.manualStatus;
    return {
      ...person,
      status,
      manualStatus: old?.manualStatus ?? null,
      note: old?.note ?? "",
      messageCount: matched.length,
      receivedItems,
      missingItems,
      lastReceivedAt: matched.map((message) => message.date).filter(Boolean).sort().at(-1) ?? null,
      evidence: matched.map((message) => ({
        uid: message.uid,
        messageId: message.messageId,
        subject: message.subject ?? "",
        attachments: (message.attachments ?? []).map((attachment) => attachment.filename).filter(Boolean),
        citation: `mail:${message.messageId ?? `${message.mailbox ?? "INBOX"}#${message.uid}`}`
      }))
    };
  });
  const unmatchedMap = new Map();
  if (mode === "roster") {
    for (const message of eligible) {
      const email = String(message.from?.address ?? "").trim().toLowerCase();
      if (!email || peopleEmails.has(email)) continue;
      const entry = unmatchedMap.get(email) ?? {
        name: String(message.from?.name ?? "").trim(),
        email,
        messageCount: 0,
        citations: []
      };
      entry.messageCount += 1;
      entry.citations.push(`mail:${message.messageId ?? `${message.mailbox ?? "INBOX"}#${message.uid}`}`);
      unmatchedMap.set(email, entry);
    }
  }
  const ledger = {
    version: 1,
    collectionId: cleanId(collectionId),
    title: String(title ?? previous?.title ?? collectionId),
    subjectKeyword,
    participantMode: mode,
    requiredItems: specs.map((item) => ({ name: item.name, aliases: item.aliases })),
    updatedAt: now.toISOString(),
    participants: scanned,
    unmatchedSubmissions: [...unmatchedMap.values()]
  };
  await saveJson(file, ledger);
  return { ...summarize(ledger), file };
}

export async function getCollection({ storeDir, collectionId }) {
  const file = storePath(storeDir, collectionId);
  const ledger = await readJson(file);
  if (!ledger) throw new Error(`collection ledger not found: ${cleanId(collectionId)}`);
  return { ...summarize(ledger), file };
}

export async function updateCollection({ storeDir, collectionId, participantEmail, status, note }) {
  if (!STATUSES.has(status)) throw new Error(`status must be one of ${[...STATUSES].join(", ")}`);
  const file = storePath(storeDir, collectionId);
  const ledger = await readJson(file);
  if (!ledger) throw new Error(`collection ledger not found: ${cleanId(collectionId)}`);
  const email = String(participantEmail ?? "").trim().toLowerCase();
  const participant = ledger.participants.find((person) => person.email === email);
  if (!participant) throw new Error(`participant not found in collection: ${email}`);
  participant.status = status;
  participant.manualStatus = status;
  if (note != null) participant.note = String(note);
  ledger.updatedAt = new Date().toISOString();
  await saveJson(file, ledger);
  return { ...summarize(ledger), updated: participant, file };
}

export function collectionRows(ledger) {
  return ledger.participants.map((participant) => ({
    name: participant.name,
    email: participant.email,
    status: participant.status,
    receivedItems: participant.receivedItems.join("; "),
    missingItems: participant.missingItems.join("; "),
    messageCount: participant.messageCount,
    lastReceivedAt: participant.lastReceivedAt ?? "",
    note: participant.note ?? ""
  }));
}
