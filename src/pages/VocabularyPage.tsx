import { useState, useEffect } from "react";
import { db } from "../Firebase";
import type { KeyboardEvent } from "react";
import {
    collection,
    addDoc,
    deleteDoc,
    doc,
    updateDoc,
    onSnapshot,
    Timestamp,
} from "firebase/firestore";

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = "Learning" | "Mastered" | "Difficult" | "New";
type TabType = "All Items" | "Words" | "Sentences" | "Collections";
type PartOfSpeech =
    | "Noun" | "Verb" | "Adjective" | "Adverb"
    | "Pronoun" | "Preposition" | "Conjunction" | "Interjection" | "Phrase";

interface DictMeaning {
    partOfSpeech: string;
    definitions: { definition: string; example?: string }[];
    synonyms?: string[];
    antonyms?: string[];
}

interface VocabItem {
    id: string;
    type: "word" | "sentence";
    word: string;
    phonetic: string;           // FIX: always string, never undefined
    partOfSpeech: PartOfSpeech; // FIX: always set, never undefined
    definition: string;         // primary (first) definition shown in cards
    allMeanings: DictMeaning[]; // FIX: store ALL meanings from API
    translation: string;        // FIX: always string, never undefined
    example: string;
    status: Status;
    starred: boolean;
    tags: string[];
    dueDate: Date;
    interval: number;
    easeFactor: number;
    repetitions: number;
    lastReview: Date | null;
}

// ─── Firestore helpers ────────────────────────────────────────────────────────

// FIX: Strip undefined values before writing to Firestore
function sanitizeForFirestore(obj: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(obj).filter(([, v]) => v !== undefined)
    );
}

function toFirestore(item: Omit<VocabItem, "id">) {
    return sanitizeForFirestore({
        type: item.type,
        word: item.word,
        phonetic: item.phonetic || "",
        partOfSpeech: item.partOfSpeech || "Noun",
        definition: item.definition || "",
        allMeanings: item.allMeanings || [],
        translation: item.translation || "",
        example: item.example || "",
        status: item.status,
        starred: item.starred,
        tags: item.tags,
        dueDate: Timestamp.fromDate(item.dueDate),
        interval: item.interval,
        easeFactor: item.easeFactor,
        repetitions: item.repetitions,
        lastReview: item.lastReview ? Timestamp.fromDate(item.lastReview) : null,
    });
}

function fromFirestore(id: string, d: Record<string, unknown>): VocabItem {
    return {
        id,
        type: (d.type as "word" | "sentence") ?? "word",
        word: (d.word as string) ?? "",
        phonetic: (d.phonetic as string) ?? "",
        partOfSpeech: (d.partOfSpeech as PartOfSpeech) ?? "Noun",
        definition: (d.definition as string) ?? "",
        allMeanings: (d.allMeanings as DictMeaning[]) ?? [],
        translation: (d.translation as string) ?? "",
        example: (d.example as string) ?? "",
        status: (d.status as Status) ?? "New",
        starred: (d.starred as boolean) ?? false,
        tags: (d.tags as string[]) ?? [],
        dueDate: d.dueDate instanceof Timestamp ? d.dueDate.toDate() : new Date(),
        interval: (d.interval as number) ?? 1,
        easeFactor: (d.easeFactor as number) ?? 2.5,
        repetitions: (d.repetitions as number) ?? 0,
        lastReview: d.lastReview instanceof Timestamp ? d.lastReview.toDate() : null,
    };
}

// ─── Free Dictionary API ──────────────────────────────────────────────────────

interface DictApiEntry {
    phonetics: { text?: string }[];
    meanings: {
        partOfSpeech: string;
        definitions: { definition: string; example?: string }[];
        synonyms?: string[];
        antonyms?: string[];
    }[];
}

async function fetchDictionary(word: string): Promise<DictApiEntry | null> {
    try {
        const res = await fetch(
            `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.trim())}`
        );
        if (!res.ok) return null;
        const data: DictApiEntry[] = await res.json();
        return data[0] ?? null;
    } catch {
        return null;
    }
}

const posMap: Record<string, PartOfSpeech> = {
    noun: "Noun", verb: "Verb", adjective: "Adjective", adverb: "Adverb",
    pronoun: "Pronoun", preposition: "Preposition", conjunction: "Conjunction",
    interjection: "Interjection",
};

// ─── SM-2 ─────────────────────────────────────────────────────────────────────

function sm2(item: VocabItem, quality: 0 | 1 | 2 | 3 | 4 | 5): VocabItem {
    let { interval, easeFactor, repetitions } = item;
    if (quality < 3) { repetitions = 0; interval = 1; }
    else {
        if (repetitions === 0) interval = 1;
        else if (repetitions === 1) interval = 6;
        else interval = Math.round(interval * easeFactor);
        repetitions += 1;
    }
    easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + interval);
    const newStatus: Status = repetitions >= 5 ? "Mastered" : quality < 3 ? "Difficult" : "Learning";
    return { ...item, interval, easeFactor, repetitions, lastReview: new Date(), dueDate: nextDue, status: newStatus };
}

// ─── Status config ────────────────────────────────────────────────────────────

const statusColors: Record<Status, { bg: string; text: string }> = {
    Learning: { bg: "bg-[#1a3a5c]", text: "text-[#4da6ff]" },
    Mastered: { bg: "bg-[#0d3320]", text: "text-[#2ecc71]" },
    Difficult: { bg: "bg-[#3a1a1a]", text: "text-[#e74c3c]" },
    New: { bg: "bg-[#2a2a40]", text: "text-[#9b8fff]" },
};

// ─── Icons ────────────────────────────────────────────────────────────────────

const SpeakerIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
);
const StarIcon = ({ filled }: { filled: boolean }) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? "#f59e0b" : "none"} stroke={filled ? "#f59e0b" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
);
const TrashIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
);
const PencilIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
);

// ─── Progress Ring ────────────────────────────────────────────────────────────

function ProgressRing({ pct, color, size = 40, stroke = 3.5 }: { pct: number; color: string; size?: number; stroke?: number }) {
    const r = (size - stroke * 2) / 2;
    const circ = 2 * Math.PI * r;
    const offset = circ - (pct / 100) * circ;
    return (
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#21262d" strokeWidth={stroke} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
                strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
                style={{ transition: "stroke-dashoffset 0.7s ease" }} />
        </svg>
    );
}

function StatCard({ label, value, sub, subColor, pct, barColor }: {
    label: string; value: string | number; sub: string;
    subColor: string; pct: number; barColor: string;
}) {
    return (
        <div className="bg-[#161b22] border border-[#21262d] rounded-2xl p-5 hover:border-[#2d333b] transition-colors">
            <div className="flex items-start justify-between mb-3">
                <div>
                    <p className="text-[#8b949e] text-xs mb-1.5">{label}</p>
                    <p className="text-3xl font-bold text-white tracking-tight">{value}</p>
                </div>
                <ProgressRing pct={pct} color={barColor} />
            </div>
            <div className="h-1 bg-[#21262d] rounded-full mb-2">
                <div className="h-1 rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: barColor }} />
            </div>
            <p className={`text-xs ${subColor}`}>{sub}</p>
        </div>
    );
}

// ─── Shared input class ───────────────────────────────────────────────────────

const inputCls = "w-full bg-[#1c2128] border border-[#2d333b] rounded-lg px-3 py-2.5 text-sm text-[#c9d1d9] placeholder-[#484f58] focus:outline-none focus:border-[#4da6ff]/60 transition-colors resize-none";

// ─── Word Form (shared by Add + Edit modals) ──────────────────────────────────

interface WordFormPayload {
    word: string;
    partOfSpeech: PartOfSpeech;
    phonetic: string;
    definition: string;
    allMeanings: DictMeaning[];
    translation: string;
    example: string;
    status: Status;
    tags: string[];
}

function WordForm({
    initial,
    onClose,
    onSave,
    title,
}: {
    initial: WordFormPayload;
    onClose: () => void;
    onSave: (p: WordFormPayload) => Promise<void>;
    title: string;
}) {
    const [word, setWord] = useState(initial.word);
    const [partOfSpeech, setPartOfSpeech] = useState<PartOfSpeech>(initial.partOfSpeech);
    const [phonetic, setPhonetic] = useState(initial.phonetic);
    const [definition, setDefinition] = useState(initial.definition);
    const [allMeanings, setAllMeanings] = useState<DictMeaning[]>(initial.allMeanings);
    const [translation, setTranslation] = useState(initial.translation);
    const [example, setExample] = useState(initial.example);
    const [status, setStatus] = useState<Status>(initial.status);
    const [tags, setTags] = useState<string[]>(initial.tags);
    const [tagInput, setTagInput] = useState("");
    const [autoFilling, setAutoFilling] = useState(false);
    const [autoFillMsg, setAutoFillMsg] = useState("");
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState<{ word?: string; definition?: string }>({});

    const handleAutoFill = async () => {
        if (!word.trim()) { setErrors({ word: "Enter a word first." }); return; }
        setAutoFilling(true); setAutoFillMsg("");
        const entry = await fetchDictionary(word.trim());
        setAutoFilling(false);
        if (!entry) { setAutoFillMsg("No definition found for this word."); return; }

        // FIX: store ALL meanings, not just first
        const meanings: DictMeaning[] = entry.meanings.map(m => ({
            partOfSpeech: m.partOfSpeech,
            definitions: m.definitions.map(d => ({ definition: d.definition, example: d.example })),
            synonyms: m.synonyms ?? [],
            antonyms: m.antonyms ?? [],
        }));
        setAllMeanings(meanings);

        const ph = entry.phonetics?.find(p => p.text)?.text ?? "";
        setPhonetic(ph);

        const firstMeaning = entry.meanings[0];
        const firstDef = firstMeaning?.definitions[0];
        if (firstDef?.definition) setDefinition(firstDef.definition);
        if (firstDef?.example) setExample(firstDef.example ?? "");
        const mapped = posMap[firstMeaning?.partOfSpeech?.toLowerCase() ?? ""];
        if (mapped) setPartOfSpeech(mapped);

        setAutoFillMsg(`✓ Fetched ${meanings.length} meaning group${meanings.length > 1 ? "s" : ""} from dictionary!`);
    };

    const addTag = (raw: string) => {
        const t = raw.trim();
        if (t && !tags.includes(t)) setTags(p => [...p, t]);
        setTagInput("");
    };
    const handleTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); }
        if (e.key === "Backspace" && tagInput === "" && tags.length > 0) setTags(p => p.slice(0, -1));
    };

    const handleSave = async () => {
        const errs: typeof errors = {};
        if (!word.trim()) errs.word = "Word is required.";
        if (!definition.trim()) errs.definition = "Definition is required.";
        if (Object.keys(errs).length) { setErrors(errs); return; }
        setSaving(true);
        await onSave({ word: word.trim(), partOfSpeech, phonetic, definition, allMeanings, translation, example, status, tags });
        setSaving(false);
        onClose();
    };

    const statusOpts: { value: Status; dot: string; active: string }[] = [
        { value: "Learning", dot: "#4da6ff", active: "border-[#4da6ff] bg-[#4da6ff]/15 text-white" },
        { value: "Mastered", dot: "#2ecc71", active: "border-[#2ecc71]/60 bg-[#2ecc71]/10 text-white" },
        { value: "Difficult", dot: "#e74c3c", active: "border-[#e74c3c]/60 bg-[#e74c3c]/10 text-white" },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="bg-[#161b22] border border-[#2d333b] rounded-2xl w-full max-w-lg mx-4 overflow-hidden shadow-2xl">

                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-6 pb-5 border-b border-[#21262d]">
                    <h2 className="text-[17px] font-semibold text-white tracking-tight">{title}</h2>
                    <button onClick={onClose} className="text-[#8b949e] hover:text-white transition-colors p-1 rounded-lg hover:bg-[#21262d]">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-4 overflow-y-auto max-h-[calc(100vh-200px)]">

                    {/* Word + POS */}
                    <div className="flex gap-3">
                        <div className="flex-1">
                            <label className="block text-sm text-[#c9d1d9] mb-1.5">Word / Phrase <span className="text-[#e74c3c]">*</span></label>
                            <input type="text" placeholder="e.g. Epiphany" value={word}
                                onChange={e => { setWord(e.target.value); setErrors(p => ({ ...p, word: undefined })); }}
                                className={`${inputCls} ${errors.word ? "border-[#e74c3c]/60" : ""}`} />
                            {errors.word && <p className="text-[#e74c3c] text-xs mt-1">{errors.word}</p>}
                        </div>
                        <div className="w-36">
                            <label className="block text-sm text-[#c9d1d9] mb-1.5">Part of Speech</label>
                            <div className="relative">
                                <select value={partOfSpeech} onChange={e => setPartOfSpeech(e.target.value as PartOfSpeech)}
                                    className={`${inputCls} appearance-none pr-8 cursor-pointer`}>
                                    {(["Noun", "Verb", "Adjective", "Adverb", "Pronoun", "Preposition", "Conjunction", "Interjection", "Phrase"] as PartOfSpeech[]).map(p =>
                                        <option key={p} value={p} className="bg-[#1c2128]">{p}</option>
                                    )}
                                </select>
                                <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8b949e] pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <polyline points="6 9 12 15 18 9" />
                                </svg>
                            </div>
                        </div>
                    </div>

                    {/* Auto-fill */}
                    <div className="flex items-center gap-3">
                        <button onClick={handleAutoFill} disabled={autoFilling}
                            className="flex items-center gap-1.5 text-xs text-[#4da6ff] hover:text-[#7ec8ff] transition-colors disabled:opacity-50">
                            {autoFilling
                                ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 8v4l3 3" /><path d="M18 2v4h4" /></svg>}
                            {autoFilling ? "Fetching all meanings…" : "Auto-fill details with AI"}
                        </button>
                        {autoFillMsg && (
                            <span className={`text-xs ${autoFillMsg.startsWith("✓") ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}>{autoFillMsg}</span>
                        )}
                    </div>

                    {/* Phonetic */}
                    <div>
                        <label className="block text-sm text-[#c9d1d9] mb-1.5">Phonetic <span className="text-[#484f58] text-xs">(Optional)</span></label>
                        <input type="text" placeholder="e.g. /ɪˈfem(ə)r(ə)l/" value={phonetic}
                            onChange={e => setPhonetic(e.target.value)} className={inputCls} />
                    </div>

                    {/* Primary Definition */}
                    <div>
                        <label className="block text-sm text-[#c9d1d9] mb-1.5">Primary Definition <span className="text-[#e74c3c]">*</span></label>
                        <textarea rows={3} placeholder="Enter the meaning..." value={definition}
                            onChange={e => { setDefinition(e.target.value); setErrors(p => ({ ...p, definition: undefined })); }}
                            className={`${inputCls} ${errors.definition ? "border-[#e74c3c]/60" : ""}`} />
                        {errors.definition && <p className="text-[#e74c3c] text-xs mt-1">{errors.definition}</p>}
                    </div>

                    {/* FIX: Show all fetched meanings preview */}
                    {allMeanings.length > 0 && (
                        <div className="bg-[#1c2128] border border-[#2d333b] rounded-xl p-4 space-y-3">
                            <p className="text-xs text-[#484f58] uppercase tracking-wider">All Dictionary Meanings ({allMeanings.length} groups)</p>
                            {allMeanings.map((m, mi) => (
                                <div key={mi}>
                                    <p className="text-xs font-semibold text-[#9b8fff] italic mb-1">{m.partOfSpeech}</p>
                                    {m.definitions.slice(0, 3).map((d, di) => (
                                        <div key={di} className="pl-2 border-l border-[#2d333b] mb-1">
                                            <p className="text-[#c9d1d9] text-xs">{di + 1}. {d.definition}</p>
                                            {d.example && <p className="text-[#6e7681] text-xs italic">"{d.example}"</p>}
                                        </div>
                                    ))}
                                    {m.definitions.length > 3 && (
                                        <p className="text-[#484f58] text-xs pl-2">+{m.definitions.length - 3} more definitions…</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Translation */}
                    <div>
                        <label className="block text-sm text-[#c9d1d9] mb-1.5">Translation <span className="text-[#484f58] text-xs">(Optional)</span></label>
                        <input type="text" placeholder="Enter translation in your native language"
                            value={translation} onChange={e => setTranslation(e.target.value)} className={inputCls} />
                    </div>

                    {/* Example */}
                    <div>
                        <label className="block text-sm text-[#c9d1d9] mb-1.5">Example Sentence</label>
                        <textarea rows={2} placeholder="Use the word in a sentence..." value={example}
                            onChange={e => setExample(e.target.value)} className={inputCls} />
                    </div>

                    {/* Status */}
                    <div>
                        <label className="block text-sm text-[#c9d1d9] mb-2.5">Initial Status</label>
                        <div className="flex items-center gap-2">
                            {statusOpts.map(({ value, dot, active }) => (
                                <button key={value} onClick={() => setStatus(value)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${status === value ? active : "border-[#2d333b] text-[#8b949e] hover:border-[#3d444d] hover:text-[#c9d1d9]"}`}>
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dot }} />
                                    {value}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Tags */}
                    <div>
                        <label className="block text-sm text-[#c9d1d9] mb-1.5">Tags</label>
                        <input type="text" placeholder="Type and press Enter to add tags" value={tagInput}
                            onChange={e => setTagInput(e.target.value)} onKeyDown={handleTagKey} className={inputCls} />
                        {tags.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2.5">
                                {tags.map(t => (
                                    <span key={t} className="flex items-center gap-1.5 px-3 py-1 bg-[#1c2128] border border-[#2d333b] rounded-lg text-xs text-[#c9d1d9]">
                                        {t}
                                        <button onClick={() => setTags(p => p.filter(x => x !== t))} className="text-[#484f58] hover:text-[#c9d1d9] transition-colors leading-none">×</button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 bg-[#1c2128] border-t border-[#21262d]">
                    <button onClick={onClose} className="px-5 py-2 rounded-xl text-sm font-medium text-[#8b949e] hover:text-white transition-colors">Cancel</button>
                    <button onClick={handleSave} disabled={saving}
                        className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#4da6ff] hover:bg-[#3a8fdf] disabled:opacity-60 text-white text-sm font-semibold transition-colors">
                        {saving
                            ? <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                        {saving ? "Saving…" : "Save Word"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Word Detail Drawer ───────────────────────────────────────────────────────

function WordDetailDrawer({ item, onClose, onEdit }: { item: VocabItem; onClose: () => void; onEdit: () => void }) {
    const speak = () => {
        if ("speechSynthesis" in window) {
            const u = new SpeechSynthesisUtterance(item.word.replace(/['"]/g, ""));
            u.lang = "en-US"; window.speechSynthesis.speak(u);
        }
    };
    const daysUntilDue = Math.max(0, Math.ceil((item.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="bg-[#161b22] border border-[#2d333b] rounded-t-2xl sm:rounded-2xl w-full max-w-lg mx-0 sm:mx-4 max-h-[88vh] overflow-y-auto shadow-2xl">

                <div className="sticky top-0 bg-[#161b22] border-b border-[#21262d] px-6 py-4 flex items-start justify-between z-10">
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-xl font-bold text-white">{item.word}</h2>
                            {item.phonetic && <span className="text-[#4da6ff] text-sm font-mono">{item.phonetic}</span>}
                            <button onClick={speak} className="text-[#4da6ff] hover:text-white transition-colors"><SpeakerIcon /></button>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className="text-xs px-2 py-0.5 rounded-md bg-[#21262d] text-[#8b949e]">{item.partOfSpeech}</span>
                            <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${statusColors[item.status].bg} ${statusColors[item.status].text}`}>
                                {item.status}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                        <button onClick={onEdit} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#2d333b] text-[#8b949e] hover:text-white hover:border-[#4da6ff]/40 transition-all">
                            <PencilIcon /> Edit
                        </button>
                        <button onClick={onClose} className="text-[#8b949e] hover:text-white p-1 rounded-lg hover:bg-[#21262d] transition-colors">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                </div>

                <div className="px-6 py-5 space-y-5">

                    {/* Primary def */}
                    <div>
                        <p className="text-xs text-[#484f58] uppercase tracking-wider mb-2">Primary Definition</p>
                        <p className="text-[#c9d1d9] text-sm leading-relaxed">{item.definition}</p>
                        {item.example && <p className="text-[#6e7681] text-xs italic mt-2">"{item.example}"</p>}
                    </div>

                    {item.translation && (
                        <div>
                            <p className="text-xs text-[#484f58] uppercase tracking-wider mb-1.5">Translation</p>
                            <p className="text-[#c9d1d9] text-sm">{item.translation}</p>
                        </div>
                    )}

                    {/* FIX: Show ALL stored meanings from dictionary */}
                    {item.allMeanings && item.allMeanings.length > 0 && (
                        <div className="border-t border-[#21262d] pt-5">
                            <p className="text-xs text-[#484f58] uppercase tracking-wider mb-4">All Meanings (dictionaryapi.dev)</p>
                            <div className="space-y-5">
                                {item.allMeanings.map((m, mi) => (
                                    <div key={mi}>
                                        <p className="text-xs font-semibold text-[#9b8fff] italic mb-2">{m.partOfSpeech}</p>
                                        <div className="space-y-2">
                                            {m.definitions.map((d, di) => (
                                                <div key={di} className="pl-3 border-l-2 border-[#2d333b]">
                                                    <p className="text-[#c9d1d9] text-sm leading-relaxed">{di + 1}. {d.definition}</p>
                                                    {d.example && <p className="text-[#6e7681] text-xs italic mt-0.5">"{d.example}"</p>}
                                                </div>
                                            ))}
                                        </div>
                                        {m.synonyms && m.synonyms.length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                <span className="text-[10px] text-[#484f58]">Synonyms:</span>
                                                {m.synonyms.slice(0, 6).map(s => (
                                                    <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-[#1c2128] border border-[#2d333b] text-[#8b949e]">{s}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* SRS stats */}
                    <div className="border-t border-[#21262d] pt-5">
                        <p className="text-xs text-[#484f58] uppercase tracking-wider mb-3">SRS Review Progress</p>
                        <div className="grid grid-cols-4 gap-2">
                            {[
                                { label: "Reps", value: item.repetitions },
                                { label: "Interval", value: `${item.interval}d` },
                                { label: "Ease", value: item.easeFactor.toFixed(1) },
                                { label: "Due in", value: daysUntilDue === 0 ? "Today" : `${daysUntilDue}d` },
                            ].map(({ label, value }) => (
                                <div key={label} className="bg-[#1c2128] rounded-xl p-3 text-center">
                                    <p className="text-white font-semibold">{value}</p>
                                    <p className="text-[#484f58] text-xs mt-0.5">{label}</p>
                                </div>
                            ))}
                        </div>
                        {item.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-3">
                                {item.tags.map(t => (
                                    <span key={t} className="px-2.5 py-1 bg-[#1c2128] border border-[#2d333b] rounded-lg text-xs text-[#8b949e]">{t}</span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Review Modal ─────────────────────────────────────────────────────────────

function ReviewModal({ items, onClose, onUpdate }: {
    items: VocabItem[]; onClose: () => void; onUpdate: (u: VocabItem) => void;
}) {
    const [queue] = useState<VocabItem[]>(() => items.filter(i => i.dueDate <= new Date()));
    const [idx, setIdx] = useState(0);
    const [revealed, setRevealed] = useState(false);
    const [done, setDone] = useState(false);

    const overlay = (content: React.ReactNode) => (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-[#161b22] border border-[#2a2f3a] rounded-2xl p-10 max-w-md w-full mx-4 text-center">{content}</div>
        </div>
    );

    if (queue.length === 0) return overlay(<>
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-xl font-bold text-white mb-2">All caught up!</h2>
        <p className="text-[#8b949e] mb-6">No words are due for review right now.</p>
        <button onClick={onClose} className="px-6 py-2 rounded-xl bg-[#4da6ff] text-white font-semibold hover:bg-[#3a8fdf] transition-colors">Close</button>
    </>);

    if (done) return overlay(<>
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-bold text-white mb-2">Session complete!</h2>
        <p className="text-[#8b949e] mb-6">You reviewed {queue.length} word{queue.length > 1 ? "s" : ""}. Great work!</p>
        <button onClick={onClose} className="px-6 py-2 rounded-xl bg-[#4da6ff] text-white font-semibold hover:bg-[#3a8fdf] transition-colors">Done</button>
    </>);

    const current = queue[idx];
    const rate = (q: 0 | 1 | 2 | 3 | 4 | 5) => {
        onUpdate(sm2(current, q));
        if (idx + 1 >= queue.length) setDone(true);
        else { setIdx(idx + 1); setRevealed(false); }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-[#161b22] border border-[#2a2f3a] rounded-2xl p-8 max-w-lg w-full mx-4">
                <div className="flex justify-between items-center mb-4">
                    <span className="text-[#8b949e] text-sm font-medium">{idx + 1} / {queue.length} due</span>
                    <button onClick={onClose} className="text-[#8b949e] hover:text-white text-xl transition-colors">×</button>
                </div>
                <div className="h-1 bg-[#21262d] rounded-full mb-8">
                    <div className="h-1 bg-[#4da6ff] rounded-full transition-all duration-500"
                        style={{ width: `${(idx / queue.length) * 100}%` }} />
                </div>
                <div className="text-center">
                    <h3 className="text-3xl font-bold text-white mb-2">{current.word}</h3>
                    {current.phonetic && <p className="text-[#4da6ff] text-sm mb-6 font-mono">{current.phonetic}</p>}
                    {!revealed
                        ? <button onClick={() => setRevealed(true)} className="mt-4 px-8 py-3 rounded-xl border border-[#2a2f3a] text-[#8b949e] hover:border-[#4da6ff] hover:text-white transition-all">
                            Show Definition
                        </button>
                        : <div className="mt-4 text-left space-y-4">
                            <p className="text-white leading-relaxed">{current.definition}</p>
                            {current.example && <p className="text-[#8b949e] italic text-sm">"{current.example}"</p>}
                            <div className="pt-4">
                                <p className="text-[#8b949e] text-xs mb-3 text-center">How well did you remember?</p>
                                <div className="grid grid-cols-4 gap-2">
                                    {([
                                        { q: 1 as const, label: "Forgot", color: "bg-[#3a1a1a] text-[#e74c3c] hover:bg-[#e74c3c] hover:text-white" },
                                        { q: 2 as const, label: "Hard", color: "bg-[#3a2a1a] text-[#f39c12] hover:bg-[#f39c12] hover:text-white" },
                                        { q: 4 as const, label: "Good", color: "bg-[#1a3a1a] text-[#2ecc71] hover:bg-[#2ecc71] hover:text-white" },
                                        { q: 5 as const, label: "Easy", color: "bg-[#1a2a3a] text-[#4da6ff] hover:bg-[#4da6ff] hover:text-white" },
                                    ] as { q: 0 | 1 | 2 | 3 | 4 | 5; label: string; color: string }[]).map(({ q, label, color }) => (
                                        <button key={q} onClick={() => rate(q)}
                                            className={`py-2 rounded-lg text-sm font-semibold transition-all ${color}`}>{label}</button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    }
                </div>
            </div>
        </div>
    );
}

// ─── Vocab Card ───────────────────────────────────────────────────────────────

function VocabCard({ item, onStar, onDelete, onClick }: {
    item: VocabItem; onStar: () => void; onDelete: () => void; onClick: () => void;
}) {
    const speak = (e: React.MouseEvent) => {
        e.stopPropagation();
        if ("speechSynthesis" in window) {
            const u = new SpeechSynthesisUtterance(item.word.replace(/['"]/g, ""));
            u.lang = "en-US"; window.speechSynthesis.speak(u);
        }
    };
    const daysUntilDue = Math.max(0, Math.ceil((item.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

    return (
        <div onClick={onClick}
            className="group border border-[#21262d] rounded-2xl p-5 hover:border-[#2d333b] hover:bg-[#0f1117] transition-all duration-200 cursor-pointer">
            <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-white font-semibold text-[15px]">{item.word}</span>
                        {item.phonetic && <span className="text-[#4da6ff] text-xs font-mono">{item.phonetic}</span>}
                        <button onClick={speak} className="text-[#4da6ff] hover:text-white transition-colors opacity-70 hover:opacity-100">
                            <SpeakerIcon />
                        </button>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#484f58]">{item.partOfSpeech}</span>
                        {item.allMeanings?.length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1c2128] text-[#9b8fff] border border-[#2d333b]">
                                {item.allMeanings.length} meaning{item.allMeanings.length > 1 ? "s" : ""}
                            </span>
                        )}
                    </div>
                    <p className="text-[#c9d1d9] text-sm leading-relaxed line-clamp-2">{item.definition}</p>
                    {item.example && <p className="text-[#6e7681] text-xs italic mt-1 line-clamp-1">"{item.example}"</p>}
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {item.type === "sentence" && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1f2937] text-[#9b8fff] border border-[#2a2f3a]">Sentence</span>
                        )}
                        {item.tags.slice(0, 2).map(t => (
                            <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-[#21262d] text-[#484f58]">{t}</span>
                        ))}
                        <span className="text-[10px] text-[#484f58]">
                            {daysUntilDue === 0 ? "⏰ Due for review" : `Next review in ${daysUntilDue}d`}
                        </span>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-3 shrink-0">
                    <span className={`text-xs font-semibold px-3 py-1 rounded-full ${statusColors[item.status].bg} ${statusColors[item.status].text}`}>
                        {item.status}
                    </span>
                    <div className="flex items-center gap-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={e => { e.stopPropagation(); onStar(); }} className="text-[#484f58] hover:text-[#f59e0b] transition-colors">
                            <StarIcon filled={item.starred} />
                        </button>
                        <button onClick={e => { e.stopPropagation(); onClick(); }} className="text-[#484f58] hover:text-[#c9d1d9] transition-colors">
                            <PencilIcon />
                        </button>
                        <button onClick={e => { e.stopPropagation(); onDelete(); }} className="text-[#484f58] hover:text-[#e74c3c] transition-colors">
                            <TrashIcon />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function SkeletonCard() {
    return (
        <div className="border border-[#21262d] rounded-2xl p-5 animate-pulse">
            <div className="flex items-start justify-between">
                <div className="flex-1 pr-4 space-y-2">
                    <div className="flex gap-2 items-center">
                        <div className="h-4 w-28 bg-[#21262d] rounded" />
                        <div className="h-3 w-20 bg-[#21262d] rounded" />
                    </div>
                    <div className="h-3 w-full bg-[#21262d] rounded" />
                    <div className="h-3 w-3/4 bg-[#21262d] rounded" />
                </div>
                <div className="h-6 w-16 bg-[#21262d] rounded-full shrink-0" />
            </div>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VocabularyPage() {
    const [items, setItems] = useState<VocabItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabType>("All Items");
    const [search, setSearch] = useState("");
    const [showReview, setShowReview] = useState(false);
    const [showAdd, setShowAdd] = useState(false);
    const [selectedItem, setSelectedItem] = useState<VocabItem | null>(null);
    const [editingItem, setEditingItem] = useState<VocabItem | null>(null);

    const tabs: TabType[] = ["All Items", "Words", "Sentences", "Collections"];

    // FIX: Use onSnapshot for real-time updates — much faster than getDocs
    // because it doesn't wait for a round-trip; the local cache is delivered
    // immediately on subsequent opens.
    useEffect(() => {
        const unsub = onSnapshot(
            collection(db, "vocabulary"),
            snapshot => {
                const data: VocabItem[] = snapshot.docs.map(d =>
                    fromFirestore(d.id, d.data() as Record<string, unknown>)
                );
                setItems(data);
                setLoading(false);
            },
            err => {
                console.error("Snapshot error:", err);
                setLoading(false);
            }
        );
        return () => unsub(); // unsubscribe on unmount
    }, []);

    // ── Derived stats ──
    const total = items.length;
    const nLearning = items.filter(i => i.status === "Learning").length;
    const nMastered = items.filter(i => i.status === "Mastered").length;
    const nDifficult = items.filter(i => i.status === "Difficult").length;
    const nNew = items.filter(i => i.status === "New").length;
    const dueCount = items.filter(i => i.dueDate <= new Date()).length;

    const masteredPct = total > 0 ? Math.round((nMastered / total) * 100) : 0;
    const learningPct = total > 0 ? Math.round((nLearning / total) * 100) : 0;
    const difficultPct = total > 0 ? Math.round((nDifficult / total) * 100) : 0;
    const newPct = total > 0 ? Math.round((nNew / total) * 100) : 0;

    const filtered = items.filter(item => {
        const matchTab = activeTab === "All Items" ? true
            : activeTab === "Words" ? item.type === "word"
                : activeTab === "Sentences" ? item.type === "sentence"
                    : false;
        const matchSearch = search.trim() === ""
            || item.word.toLowerCase().includes(search.toLowerCase())
            || item.definition.toLowerCase().includes(search.toLowerCase());
        return matchTab && matchSearch;
    });

    // ── CRUD ──

    const update = async (updated: VocabItem) => {
        // Optimistic update
        setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
        try {
            await updateDoc(doc(db, "vocabulary", updated.id), toFirestore(updated));
        } catch (err) {
            console.error("Update failed:", err);
        }
    };

    const toggleStar = async (id: string) => {
        const item = items.find(i => i.id === id);
        if (!item) return;
        const updated = { ...item, starred: !item.starred };
        setItems(prev => prev.map(i => i.id === id ? updated : i));
        try {
            await updateDoc(doc(db, "vocabulary", id), { starred: updated.starred });
        } catch (err) {
            console.error("Star update failed:", err);
        }
    };

    const deleteItem = async (id: string) => {
        const backup = [...items];
        setItems(prev => prev.filter(i => i.id !== id));
        try {
            await deleteDoc(doc(db, "vocabulary", id));
        } catch (err) {
            console.error("Delete failed:", err);
            setItems(backup);
        }
    };

    // FIX: Sanitize payload — no undefined fields reach Firestore
    const handleAddSave = async (payload: WordFormPayload) => {
        const newItem = {
            type: "word" as const,
            word: payload.word,
            phonetic: payload.phonetic || "",
            partOfSpeech: payload.partOfSpeech || "Noun" as PartOfSpeech,
            definition: payload.definition,
            allMeanings: payload.allMeanings || [],
            translation: payload.translation || "",
            example: payload.example || "",
            status: payload.status,
            starred: false,
            tags: payload.tags,
            dueDate: new Date(),
            interval: 1,
            easeFactor: 2.5,
            repetitions: 0,
            lastReview: null,
        };

        // Optimistic add with temp id
        const tempId = `temp_${Date.now()}`;
        setItems(prev => [...prev, { id: tempId, ...newItem }]);

        try {
            const docRef = await addDoc(collection(db, "vocabulary"), toFirestore(newItem));
            // Replace temp with real id
            setItems(prev => prev.map(i => i.id === tempId ? { ...i, id: docRef.id } : i));
        } catch (err) {
            console.error("Add failed:", err);
            setItems(prev => prev.filter(i => i.id !== tempId));
        }
    };

    const handleEditSave = async (payload: WordFormPayload) => {
        if (!editingItem) return;
        const updated: VocabItem = {
            ...editingItem,
            word: payload.word,
            phonetic: payload.phonetic || "",
            partOfSpeech: payload.partOfSpeech,
            definition: payload.definition,
            allMeanings: payload.allMeanings,
            translation: payload.translation || "",
            example: payload.example || "",
            status: payload.status,
            tags: payload.tags,
        };
        await update(updated);
        setEditingItem(null);
        // Refresh selectedItem if it was open
        if (selectedItem?.id === updated.id) setSelectedItem(updated);
    };

    const blankForm: WordFormPayload = {
        word: "", partOfSpeech: "Noun", phonetic: "",
        definition: "", allMeanings: [], translation: "",
        example: "", status: "Learning", tags: [],
    };

    const editForm = (item: VocabItem): WordFormPayload => ({
        word: item.word, partOfSpeech: item.partOfSpeech, phonetic: item.phonetic,
        definition: item.definition, allMeanings: item.allMeanings ?? [],
        translation: item.translation ?? "", example: item.example,
        status: item.status, tags: item.tags,
    });

    return (
        <div className="min-h-screen bg-[#0d1117] text-white font-sans">
            <div className="max-w-4xl mx-auto px-6 py-8">

                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <button className="text-[#8b949e] hover:text-white transition-colors p-1">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
                            </svg>
                        </button>
                        <h1 className="text-2xl font-bold tracking-tight">Vocabulary</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setShowReview(true)}
                            className="relative flex items-center gap-2 px-4 py-2 rounded-xl bg-[#4da6ff]/10 border border-[#4da6ff]/30 text-[#4da6ff] text-sm font-semibold hover:bg-[#4da6ff]/20 transition-all">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                            </svg>
                            Review
                            {dueCount > 0 && (
                                <span className="absolute -top-1.5 -right-1.5 bg-[#e74c3c] text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{dueCount}</span>
                            )}
                        </button>
                        <button className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#21262d] text-[#c9d1d9] text-sm font-medium hover:border-[#4da6ff]/40 hover:text-white transition-all">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            Import
                        </button>
                        <button onClick={() => setShowAdd(true)}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#21262d] text-[#c9d1d9] text-sm font-medium hover:border-[#4da6ff]/40 hover:text-white transition-all">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            Add New Word
                        </button>
                    </div>
                </div>

                {/* Mastery Banner */}
                <div className="bg-[#161b22] border border-[#21262d] rounded-2xl px-6 py-4 mb-6">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <span className="text-sm font-semibold text-white">Overall Mastery Progress</span>
                            <span className="text-[#484f58] text-xs ml-2">{nMastered} of {total} words mastered</span>
                        </div>
                        <span className="text-2xl font-bold text-white">{masteredPct}%</span>
                    </div>
                    <div className="h-2.5 bg-[#21262d] rounded-full overflow-hidden flex gap-px">
                        {newPct > 0 && <div className="h-full bg-[#9b8fff] transition-all duration-700" style={{ width: `${newPct}%` }} />}
                        {learningPct > 0 && <div className="h-full bg-[#4da6ff] transition-all duration-700" style={{ width: `${learningPct}%` }} />}
                        {difficultPct > 0 && <div className="h-full bg-[#e74c3c] transition-all duration-700" style={{ width: `${difficultPct}%` }} />}
                        {masteredPct > 0 && <div className="h-full bg-[#2ecc71] transition-all duration-700" style={{ width: `${masteredPct}%` }} />}
                    </div>
                    <div className="flex items-center gap-5 mt-2.5 flex-wrap">
                        {[
                            { label: "New", count: nNew, color: "bg-[#9b8fff]", pct: newPct },
                            { label: "Learning", count: nLearning, color: "bg-[#4da6ff]", pct: learningPct },
                            { label: "Difficult", count: nDifficult, color: "bg-[#e74c3c]", pct: difficultPct },
                            { label: "Mastered", count: nMastered, color: "bg-[#2ecc71]", pct: masteredPct },
                        ].map(({ label, count, color, pct }) => (
                            <div key={label} className="flex items-center gap-1.5">
                                <span className={`w-2 h-2 rounded-full ${color}`} />
                                <span className="text-[#8b949e] text-xs">
                                    {label} <span className="text-white font-medium">{count}</span>
                                    <span className="text-[#484f58] ml-1">({pct}%)</span>
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Stat Cards */}
                <div className="grid grid-cols-4 gap-4 mb-8">
                    <StatCard label="Total Saved" value={total.toLocaleString()}
                        sub={dueCount > 0 ? `${dueCount} due for review` : "All reviewed!"}
                        subColor={dueCount > 0 ? "text-[#f39c12]" : "text-[#2ecc71]"}
                        pct={Math.min(100, Math.round((total / Math.max(total, 20)) * 100))} barColor="#2ecc71" />
                    <StatCard label="Learning" value={nLearning} sub={`${learningPct}% of total`}
                        subColor="text-[#4da6ff]" pct={learningPct} barColor="#4da6ff" />
                    <StatCard label="Mastered" value={nMastered} sub={`${masteredPct}% mastered`}
                        subColor="text-[#2ecc71]" pct={masteredPct} barColor="#2ecc71" />
                    <StatCard label="Difficult" value={nDifficult}
                        sub={nDifficult > 0 ? "Needs review" : "None difficult!"}
                        subColor={nDifficult > 0 ? "text-[#e74c3c]" : "text-[#2ecc71]"}
                        pct={difficultPct} barColor="#e74c3c" />
                </div>

                {/* Tabs + Search */}
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center bg-[#161b22] border border-[#21262d] rounded-xl p-1 gap-1">
                        {tabs.map(tab => (
                            <button key={tab} onClick={() => setActiveTab(tab)}
                                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === tab ? "bg-[#4da6ff]/15 text-[#4da6ff]" : "text-[#8b949e] hover:text-[#c9d1d9]"}`}>
                                {tab}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#484f58]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                            <input type="text" placeholder="Search vocabulary..." value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="bg-[#161b22] border border-[#21262d] rounded-xl pl-9 pr-4 py-2 text-sm text-[#c9d1d9] placeholder-[#484f58] focus:outline-none focus:border-[#4da6ff]/50 transition-colors w-52" />
                        </div>
                        <button className="p-2 rounded-xl border border-[#21262d] text-[#8b949e] hover:text-white hover:border-[#2a2f3a] transition-all">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Word list */}
                <div className="space-y-3">
                    {loading
                        ? Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
                        : filtered.length === 0
                            ? <div className="text-center py-16 text-[#484f58]"><p className="text-4xl mb-3">📭</p><p>No vocabulary items found.</p></div>
                            : filtered.map(item => (
                                <VocabCard key={item.id} item={item}
                                    onStar={() => toggleStar(item.id)}
                                    onDelete={() => deleteItem(item.id)}
                                    onClick={() => setSelectedItem(item)} />
                            ))
                    }
                </div>
            </div>

            {/* Modals */}
            {showReview && <ReviewModal items={items} onClose={() => setShowReview(false)} onUpdate={update} />}

            {showAdd && (
                <WordForm title="Add New Vocabulary" initial={blankForm}
                    onClose={() => setShowAdd(false)} onSave={handleAddSave} />
            )}

            {editingItem && (
                <WordForm title={`Edit — ${editingItem.word}`} initial={editForm(editingItem)}
                    onClose={() => setEditingItem(null)} onSave={handleEditSave} />
            )}

            {selectedItem && (
                <WordDetailDrawer
                    item={selectedItem}
                    onClose={() => setSelectedItem(null)}
                    onEdit={() => {
                        setEditingItem(selectedItem);
                        setSelectedItem(null);
                    }}
                />
            )}
        </div>
    );
}
