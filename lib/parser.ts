import type { ClientRecord, ParsedOrderDraft, PaymentType } from "@/types";
import { createId } from "@/lib/utils";

export function normalizePhone(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 && digits.startsWith("0")) return `+38${digits}`;
  if (digits.length === 12 && digits.startsWith("380")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("80")) return `+3${digits}`;
  return value.trim();
}

export function normalizeSum(value: string) {
  const clean = String(value || "").replace(/[^\d.,\s]/g, "").replace(/[,.](?=\d{3}\b)/g, " ").trim();
  const digits = clean.replace(/[^\d]/g, "");
  return digits ? `${digits} грн` : "0 грн";
}

function extractPhone(text: string) {
  const matches = text.match(/\+?\d[\d\s()\-]{8,}\d/g) || [];
  for (const match of matches) {
    const normalized = normalizePhone(match);
    const digits = normalized.replace(/\D/g, "");
    if (digits.length === 12 || digits.length === 10) return normalized;
  }
  return "";
}

function extractSum(text: string) {
  const matches = [...text.matchAll(/(\d[\d\s.,]*)\s*(грн|₴)/gi)];
  if (matches.length) return normalizeSum(matches[matches.length - 1][1]);
  const labeled = text.match(/(?:сумма|итого|к оплате)\s*[:\-]?\s*(\d[\d\s.,]*)/i);
  if (labeled) return normalizeSum(labeled[1]);
  return "0 грн";
}

function extractPayment(text: string): PaymentType {
  const explicitCash = /(налич|нал\b|налом|cash|оплата при|при получ)/i.test(text);
  const explicitCard = /(карт|card|онлайн|безнал)/i.test(text);
  const uncertainPayment = /(уточни|думает|ще дума|еще дума|ще не виріш|еще не реш|не решила|не вирішила|оплата.*уточ)/i.test(text);
  const sum = extractSum(text);
  if (uncertainPayment) return "КАРТА";
  if (explicitCash) return "НАЛИЧНЫЕ";
  if (explicitCard) return "КАРТА";
  if (sum !== "0 грн") return "НАЛИЧНЫЕ";
  return "КАРТА";
}

function stripKnownLabel(line: string) {
  return line
    .replace(/^(?:фио|имя|клиент|получатель|адрес|телефон|тел\.?|номер|сумма|итого|комментарий|коммент|примечание)\s*[:\-]\s*/i, "")
    .replace(/^(?:доставка)\s*[:\-]?\s*/i, "")
    .trim();
}

function isServiceLine(line: string) {
  return /^(?:anna raywell|odessa:|доставка:|заказ|новый заказ|\[\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}\])$/i.test(line.trim());
}

function isNoteLine(line: string) {
  return /(❗️|❗|вход|лифт|этаж|домофон|код|кв\.|квартира|подъезд|перезвон|коммент|примечан)/i.test(line);
}

function looksLikeAddress(line: string) {
  return /(ул\.?|улиц|просп|пр\.|переул|пер\.|бульв|бул\.|дорога|шоссе|пл\.|площад|дом|кв\.|квартира|подъезд|этаж)/i.test(line) || (/\d/.test(line) && line.length >= 6);
}

function looksLikeName(line: string) {
  return !/\d/.test(line) && line.length >= 3 && line.length <= 60;
}

function looksLikeAddressDetail(line: string) {
  return /(офіс|офис|центр|поверх|этаж|кабинет|каб\.|корпус|строение|бизнес|бц|приморськ|дом|будинок)/i.test(line);
}

function isPaymentLine(line: string) {
  return /(оплата|налич|налом|карт|безнал|cash|сумма|итого|к оплате)/i.test(line);
}

function isLikelyNewOrderBlock(text: string) {
  const lines = text.split("\n").map(stripKnownLabel).filter(Boolean);
  if (!lines.length) return false;
  if (extractPhone(text)) return true;
  const firstLine = lines[0];
  const hasNameLikeFirstLine = looksLikeName(firstLine) && !looksLikeAddress(firstLine) && !isNoteLine(firstLine);
  const hasOrderSignals = lines.slice(1).some((line) => looksLikeAddress(line) || looksLikeAddressDetail(line) || isPaymentLine(line) || /(\d[\d\s.,]*)\s*(грн|₴)/i.test(line));
  return hasNameLikeFirstLine && hasOrderSignals;
}

function splitIntoBlocks(raw: string) {
  const normalized = raw.replace(/\r/g, "").trim();
  if (!normalized) return [];
  const headerPattern = /(?:^|\n)(?=\[\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}\][^\n]*)/g;
  const headerMatches = [...normalized.matchAll(headerPattern)];
  if (headerMatches.length > 1) {
    const blocks: string[] = [];
    for (let i = 0; i < headerMatches.length; i++) {
      const start = headerMatches[i].index === 0 ? 0 : (headerMatches[i].index ?? 0) + 1;
      const end = i + 1 < headerMatches.length ? headerMatches[i + 1].index : normalized.length;
      const chunk = normalized.slice(start, end).trim();
      if (chunk) blocks.push(chunk);
    }
    return blocks;
  }

  const rawBlocks = normalized.split(/\n\s*\n/);
  const blocks: string[] = [];
  rawBlocks.forEach((block) => {
    const text = block.trim();
    if (!text) return;
    const appendToPrevious = blocks.length > 0 && (text.match(/^\d+\s*(грн|₴)$/i) || text.toLowerCase().includes("оплата") || !isLikelyNewOrderBlock(text));
    if (appendToPrevious) blocks[blocks.length - 1] += `\n${text}`;
    else blocks.push(text);
  });
  return blocks;
}

function parseHeaderLine(line: string) {
  const match = line.match(/^\[\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}\]\s*(.+?)\s*:\s*(.+)$/);
  if (!match) return null;
  return { source: match[1].trim(), name: match[2].trim() };
}

export function parseOrders(raw: string, clients: ClientRecord[]) {
  const blocks = splitIntoBlocks(raw);

  return blocks
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const draft: ParsedOrderDraft = {
        id: createId(),
        name: "",
        phone: "",
        addr: "",
        sum: "0 грн",
        pay: "КАРТА",
        note: "",
        done: false,
        isOld: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const header = lines.length ? parseHeaderLine(lines[0]) : null;
      if (header) {
        draft.name = header.name;
        lines[0] = header.name;
      }

      draft.phone = extractPhone(block);
      draft.sum = extractSum(block);
      draft.pay = extractPayment(block);

      const normalizedLines = lines.map(stripKnownLabel).filter(Boolean);
      const cleanLines = normalizedLines.filter((line) => {
        const low = line.toLowerCase();
        return line && !isServiceLine(line) && !extractPhone(line) && !/^\d[\d\s.,]*\s*(грн|₴)?$/i.test(line) && !low.includes("оплата") && !low.includes("сумма");
      });

      const existing = clients.find((client) => normalizePhone(client.phone) === draft.phone);
      if (existing) {
        draft.isOld = true;
        draft.name = existing.name;
        draft.addr = existing.addr;
      } else {
        const labeledName = lines.find((line) => /^(?:фио|имя|клиент|получатель)\s*[:\-]/i.test(line));
        const labeledAddr = lines.find((line) => /^(?:адрес)\s*[:\-]/i.test(line));
        const firstMeaningfulLine = cleanLines[0] || "";
        const nameCandidate = labeledName ? stripKnownLabel(labeledName) : draft.name || firstMeaningfulLine || cleanLines.find(looksLikeName) || "";
        const addressStart = labeledAddr ? stripKnownLabel(labeledAddr) : cleanLines.find((line) => line !== nameCandidate && looksLikeAddress(line)) || "";
        draft.name = stripKnownLabel(nameCandidate);
        draft.addr = addressStart;
        if (!draft.addr && cleanLines.length > 1) {
          draft.addr = cleanLines.find((line) => line !== draft.name) || "";
        }
      }

      if (!draft.addr) {
        const unlabeledAddress = lines.map(stripKnownLabel).find((line) => line !== draft.name && !extractPhone(line) && looksLikeAddress(line));
        if (unlabeledAddress) draft.addr = unlabeledAddress;
      }

      const addressParts: string[] = [];
      const addressStartIndex = normalizedLines.findIndex((line) => line === draft.addr || (looksLikeAddress(line) && line.includes(draft.addr)));
      if (addressStartIndex >= 0) {
        addressParts.push(normalizedLines[addressStartIndex]);
        for (let idx = addressStartIndex + 1; idx < normalizedLines.length; idx++) {
          const line = normalizedLines[idx];
          if (!line || line === draft.name) continue;
          if (extractPhone(line) || /^\d[\d\s.,]*\s*(грн|₴)?$/i.test(line) || isPaymentLine(line)) break;
          if (looksLikeAddressDetail(line) || (!isNoteLine(line) && !looksLikeAddress(line) && line.length <= 80 && addressParts.length < 3)) {
            addressParts.push(line);
            continue;
          }
          break;
        }
      }
      if (addressParts.length) draft.addr = addressParts.join(", ");

      const noteLines = normalizedLines.filter((line) => {
        if (!line || line === draft.name) return false;
        if (extractPhone(line)) return false;
        if (/^\d[\d\s.,]*\s*(грн|₴)?$/i.test(line)) return false;
        if (isPaymentLine(line)) return false;
        if (draft.addr && draft.addr.includes(line)) return false;
        return isNoteLine(line) || (!looksLikeAddress(line) && !looksLikeAddressDetail(line));
      });
      if (noteLines.length) draft.note = [...new Set(noteLines)].join(" ");

      draft.name = draft.name.replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim();
      draft.addr = draft.addr.replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim();
      draft.note = draft.note.replace(/\s+/g, " ").trim();
      return draft;
    })
    .filter((order) => order.name.length > 2 && (order.phone || order.addr));
}
