import { useState, useRef, type KeyboardEvent } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = "Learning" | "Mastered" | "Difficult";
type PartOfSpeech =
    | "Noun" | "Verb" | "Adjective" | "Adverb"
    | "Pronoun" | "Preposition" | "Conjunction" | "Interjection" | "Phrase";

export interface NewVocabItem {
    word: string;
    partOfSpeech: PartOfSpeech;
    definition: string;
    translation: string;
    example: string;
    status: Status;
    tags: string[];
}

interface Props {
    onClose: () => void;
    onSave: (item: NewVocabItem) => void;
}

// ─── Free Dictionary API ──────────────────────────────────────────────────────

interface DictEntry {
    phonetic?: string;
    meanings: {
        partOfSpeech: string;
        definitions: { definition: string; example?: string }[];
    }[];
}

async function fetchDefinition(word: string): Promise<DictEntry | null> {
    try {
        const res = await fetch(
            `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.trim())}`
        );
        if (!res.ok) return null;
        const data: DictEntry[] = await res.json();
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function AddWord({ onClose, onSave }: Props) {
    const [word, setWord] = useState("");
    const [partOfSpeech, setPartOfSpeech] = useState<PartOfSpeech>("Noun");
    const [definition, setDefinition] = useState("");
    const [translation, setTranslation] = useState("");
    const [example, setExample] = useState("");
    const [status, setStatus] = useState<Status>("Learning");
    const [tags, setTags] = useState<string[]>(["Business", "Meeting"]);
    const [tagInput, setTagInput] = useState("");
    const [autoFilling, setAutoFilling] = useState(false);
    const [autoFillError, setAutoFillError] = useState("");
    const [errors, setErrors] = useState<{ word?: string; definition?: string }>({});

    const tagInputRef = useRef<HTMLInputElement>(null);

    // ── Auto-fill via free dictionary API ──
    const handleAutoFill = async () => {
        if (!word.trim()) {
            setErrors({ word: "Enter a word first." });
            return;
        }
        setAutoFilling(true);
        setAutoFillError("");
        const entry = await fetchDefinition(word.trim());
        setAutoFilling(false);

        if (!entry) {
            setAutoFillError("No definition found. Try a different word.");
            return;
        }

        const firstMeaning = entry.meanings[0];
        const firstDef = firstMeaning?.definitions[0];

        if (firstDef?.definition) setDefinition(firstDef.definition);
        if (firstDef?.example) setExample(firstDef.example);

        const mappedPos = posMap[firstMeaning?.partOfSpeech?.toLowerCase() ?? ""];
        if (mappedPos) setPartOfSpeech(mappedPos);
    };

    // ── Tags ──
    const addTag = (raw: string) => {
        const t = raw.trim();
        if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
        setTagInput("");
    };

    const handleTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); }
        if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
            setTags((prev) => prev.slice(0, -1));
        }
    };

    const removeTag = (t: string) => setTags((prev) => prev.filter((x) => x !== t));

    // ── Save ──
    const handleSave = () => {
        const errs: typeof errors = {};
        if (!word.trim()) errs.word = "Word is required.";
        if (!definition.trim()) errs.definition = "Definition is required.";
        if (Object.keys(errs).length) { setErrors(errs); return; }

        onSave({ word: word.trim(), partOfSpeech, definition, translation, example, status, tags });
        onClose();
    };

    // ─── Status pill config ───
    const statusOptions: { value: Status; dot: string; active: string }[] = [
        { value: "Learning", dot: "#4da6ff", active: "border-[#4da6ff] bg-[#4da6ff]/15 text-white" },
        { value: "Mastered", dot: "#2ecc71", active: "border-[#2ecc71]/60 bg-[#2ecc71]/10 text-white" },
        { value: "Difficult", dot: "#e74c3c", active: "border-[#e74c3c]/60 bg-[#e74c3c]/10 text-white" },
    ];

    // ─── Shared input style ───
    const inputCls =
        "w-full bg-[#1c2128] border border-[#2d333b] rounded-lg px-3 py-2.5 text-sm text-[#c9d1d9] placeholder-[#484f58] focus:outline-none focus:border-[#4da6ff]/60 transition-colors resize-none";

    return (
        /* Backdrop */
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            {/* Modal */}
            <div className="bg-[#161b22] border border-[#2d333b] rounded-2xl w-full max-w-lg mx-4 overflow-hidden shadow-2xl">

                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-6 pb-5 border-b border-[#21262d]">
                    <h2 className="text-[17px] font-semibold text-white tracking-tight">Add New Vocabulary</h2>
                    <button
                        onClick={onClose}
                        className="text-[#8b949e] hover:text-white transition-colors p-1 rounded-lg hover:bg-[#21262d]"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Scrollable body */}
                <div className="px-6 py-5 space-y-5 overflow-y-auto max-h-[calc(100vh-180px)]">

                    {/* Word + Part of Speech row */}
                    <div className="flex gap-3">
                        {/* Word */}
                        <div className="flex-1">
                            <label className="block text-sm text-[#c9d1d9] mb-1.5">
                                Word / Phrase <span className="text-[#e74c3c]">*</span>
                            </label>
                            <input
                                type="text"
                                placeholder="e.g. Epiphany"
                                value={word}
                                onChange={(e) => { setWord(e.target.value); setErrors((p) => ({ ...p, word: undefined })); }}
                                className={`${inputCls} ${errors.word ? "border-[#e74c3c]/60" : ""}`}
                            />
                            {errors.word && <p className="text-[#e74c3c] text-xs mt-1">{errors.word}</p>}
                        </div>

                        {/* Part of Speech */}
                        <div className="w-36">
                            <label className="block text-sm text-[#c9d1d9] mb-1.5">Part of Speech</label>
                            <div className="relative">
                                <select
                                    value={partOfSpeech}
                                    onChange={(e) => setPartOfSpeech(e.target.value as PartOfSpeech)}
                                    className={`${inputCls} appearance-none pr-8 cursor-pointer`}
                                >
                                    {(["Noun", "Verb", "Adjective", "Adverb", "Pronoun", "Preposition", "Conjunction", "Interjection", "Phrase"] as PartOfSpeech[]).map((p) => (
                                        <option key={p} value={p} className="bg-[#1c2128]">{p}</option>
                                    ))}
                                </select>
                                <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8b949e] pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
                            </div>
                        </div>
                    </div>

                    {/* Auto-fill */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleAutoFill}
                            disabled={autoFilling}
                            className="flex items-center gap-1.5 text-xs text-[#4da6ff] hover:text-[#7ec8ff] transition-colors disabled:opacity-50"
                        >
                            {autoFilling ? (
                                <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                            ) : (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 8v4l3 3" /><path d="M18 2v4h4" /></svg>
                            )}
                            {autoFilling ? "Fetching definition…" : "Auto-fill details with AI"}
                        </button>
                        {autoFillError && (
                            <span className="text-xs text-[#e74c3c]">{autoFillError}</span>
                        )}
                    </div>

                    {/* Definition */}
                    <div>
                        <label className="block text-sm text-[#c9d1d9] mb-1.5">Definition</label>
                        <textarea
                            rows={4}
                            placeholder="Enter the meaning..."
                            value={definition}
                            onChange={(e) => { setDefinition(e.target.value); setErrors((p) => ({ ...p, definition: undefined })); }}
                            className={`${inputCls} ${errors.definition ? "border-[#e74c3c]/60" : ""}`}
                        />
                        {errors.definition && <p className="text-[#e74c3c] text-xs mt-1">{errors.definition}</p>}
                    </div>

                    {/* Translation */}
                    <div>
                        <label className="block text-sm text-[#c9d1d9] mb-1.5">
                            Translation <span className="text-[#484f58] text-xs">(Optional)</span>
                        </label>
                        <input
                            type="text"
                            placeholder="Enter translation in your native language"
                            value={translation}
                            onChange={(e) => setTranslation(e.target.value)}
                            className={inputCls}
                        />
                    </div>

                    {/* Example Sentence */}
                    <div>
                        <label className="block text-sm text-[#c9d1d9] mb-1.5">Example Sentence</label>
                        <textarea
                            rows={3}
                            placeholder="Use the word in a sentence..."
                            value={example}
                            onChange={(e) => setExample(e.target.value)}
                            className={inputCls}
                        />
                    </div>

                    {/* Initial Status */}
                    <div>
                        <label className="block text-sm text-[#c9d1d9] mb-2.5">Initial Status</label>
                        <div className="flex items-center gap-2">
                            {statusOptions.map(({ value, dot, active }) => (
                                <button
                                    key={value}
                                    onClick={() => setStatus(value)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${status === value
                                        ? active
                                        : "border-[#2d333b] text-[#8b949e] hover:border-[#3d444d] hover:text-[#c9d1d9]"
                                        }`}
                                >
                                    <span
                                        className="w-2 h-2 rounded-full flex-shrink-0"
                                        style={{ background: dot }}
                                    />
                                    {value}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Tags */}
                    <div>
                        <label className="block text-sm text-[#c9d1d9] mb-1.5">Tags</label>
                        <input
                            ref={tagInputRef}
                            type="text"
                            placeholder="Type and press Enter to add tags"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={handleTagKey}
                            className={inputCls}
                        />
                        {tags.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2.5">
                                {tags.map((t) => (
                                    <span
                                        key={t}
                                        className="flex items-center gap-1.5 px-3 py-1 bg-[#1c2128] border border-[#2d333b] rounded-lg text-xs text-[#c9d1d9]"
                                    >
                                        {t}
                                        <button
                                            onClick={() => removeTag(t)}
                                            className="text-[#484f58] hover:text-[#c9d1d9] transition-colors leading-none"
                                        >
                                            ×
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 bg-[#1c2128] border-t border-[#21262d]">
                    <button
                        onClick={onClose}
                        className="px-5 py-2 rounded-xl text-sm font-medium text-[#8b949e] hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#4da6ff] hover:bg-[#3a8fdf] text-white text-sm font-semibold transition-colors"
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Save Word
                    </button>
                </div>
            </div>
        </div>
    );
}