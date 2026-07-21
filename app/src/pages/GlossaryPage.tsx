// Standalone full-page glossary — reachable from Home's footer link (and
// anywhere else that wants to point at the whole reference instead of the
// embedded toggle panels on Win Types / Grading Model Features).
import { Glossary } from "../components/Glossary";
import { GLOSSARY_SECTIONS } from "../lib/glossary";

export default function GlossaryPage() {
  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-[#002f6c]">
        <span className="h-6 w-1.5 rounded-full bg-gradient-to-b from-[#002f6c] to-[#164a9c]" />
        Glossary
      </h1>
      <p className="text-sm text-slate-500">
        Win types, stat definitions, and betting/model terms used throughout the app — the same content as the toggle panels on Win Types and
        the Grading Model's Features tab.
      </p>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <Glossary sections={GLOSSARY_SECTIONS} />
      </div>
    </div>
  );
}
