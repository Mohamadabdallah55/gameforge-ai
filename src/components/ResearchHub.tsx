import React, { useState } from "react";
import { Search, DownloadCloud, ExternalLink, Globe, Image as ImageIcon } from "lucide-react";
import type { Evidence, SearchImageHit } from "../types";

interface Props {
  busy: boolean;
  onSearchFacts: (
    query: string,
    source: "auto" | "google" | "wikipedia" | "tavily",
  ) => Promise<Evidence[]>;
  onSearchImages: (
    query: string,
    source: "all" | "wikimedia" | "openverse",
  ) => Promise<SearchImageHit[]>;
  onImportImageHit: (hit: SearchImageHit) => Promise<void>;
}

export function ResearchHub({
  busy,
  onSearchFacts,
  onSearchImages,
  onImportImageHit,
}: Props) {
  const [query, setQuery] = useState("");
  const [factSource, setFactSource] = useState<
    "auto" | "google" | "wikipedia" | "tavily"
  >("auto");
  const [imageSource, setImageSource] = useState<
    "all" | "wikimedia" | "openverse"
  >("all");
  const [factHits, setFactHits] = useState<Evidence[]>([]);
  const [imageHits, setImageHits] = useState<SearchImageHit[]>([]);
  const [mode, setMode] = useState<"facts" | "images">("facts");

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-lg font-bold text-slate-900">
            بحث المصادر والصور الحقيقية
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            ابحث عبر Google Search وويكيبيديا عن الأدلة الموثقة، أو ابحث عن صور مرخصة في Wikimedia Commons وOpenverse واحفظها مباشرة في مكتبة الوسائط.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <label className="md:col-span-6 block text-xs font-medium text-slate-700">
            عبارة البحث
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-800 focus:outline-none"
              placeholder="مثال: كأس العالم 2022 أو Amman Roman theatre"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          <label className="md:col-span-3 block text-xs font-medium text-slate-700">
            مصدر المعلومات
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              value={factSource}
              onChange={(e) => setFactSource(e.target.value as any)}
            >
              <option value="auto">تلقائي (Google + ويكيبيديا)</option>
              <option value="google">Google Search الحي</option>
              <option value="wikipedia">ويكيبيديا</option>
              <option value="tavily">Tavily</option>
            </select>
          </label>

          <label className="md:col-span-3 block text-xs font-medium text-slate-700">
            مصدر الصور الحقيقية
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              value={imageSource}
              onChange={(e) => setImageSource(e.target.value as any)}
            >
              <option value="all">Commons + Openverse</option>
              <option value="wikimedia">Wikimedia Commons</option>
              <option value="openverse">Openverse</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || !query.trim()}
            onClick={() =>
              void onSearchFacts(query.trim(), factSource).then((rs) => {
                setMode("facts");
                setFactHits(rs);
              })
            }
            className="inline-flex items-center gap-2 rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            <Globe className="w-4 h-4" />
            معلومات
          </button>

          <button
            type="button"
            disabled={busy || !query.trim()}
            onClick={() =>
              void onSearchImages(query.trim(), imageSource).then((rs) => {
                setMode("images");
                setImageHits(rs);
              })
            }
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            <ImageIcon className="w-4 h-4 text-emerald-900" />
            صور حقيقية
          </button>
        </div>
      </section>

      {mode === "facts" && factHits.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">
            نتائج المعلومات ({factHits.length})
          </h3>
          <div className="divide-y divide-slate-200">
            {factHits.map((h) => (
              <article key={h.url} className="py-4 first:pt-0 last:pb-0 space-y-1.5">
                <a
                  href={h.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-900 hover:underline"
                >
                  {h.title}
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <p className="text-xs text-slate-500 font-mono-num truncate">
                  {h.url}
                </p>
                <p className="text-sm text-slate-700 leading-relaxed">
                  {h.text.slice(0, 650)}
                  {h.text.length > 650 ? "..." : ""}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      {mode === "images" && imageHits.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">
            نتائج الصور الحقيقية ({imageHits.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {imageHits.map((h) => (
              <article
                key={h.url}
                className="border border-slate-200 rounded-md p-3 flex flex-col justify-between gap-3"
              >
                <div className="space-y-2">
                  <div className="h-44 w-full rounded bg-slate-100 overflow-hidden">
                    <img
                      src={h.url}
                      alt={h.title}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      onError={(e) => {
                        if (
                          h.fallbackUrl &&
                          e.currentTarget.src !== h.fallbackUrl
                        ) {
                          e.currentTarget.src = h.fallbackUrl;
                        }
                      }}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <a
                    href={h.origin}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs font-semibold text-slate-900 hover:text-emerald-900 line-clamp-2"
                  >
                    {h.title}
                  </a>
                  <p className="text-[11px] text-slate-500">
                    {h.provider === "openverse" ? "Openverse" : "Wikimedia"} ·{" "}
                    {h.license} · {h.credit}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onImportImageHit(h)}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-900 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  <DownloadCloud className="w-3.5 h-3.5" />
                  استيراد إلى المكتبة
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {((mode === "facts" && factHits.length === 0) ||
        (mode === "images" && imageHits.length === 0)) && (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center space-y-1.5">
          <Search className="w-5 h-5 text-slate-400 mx-auto" />
          <p className="text-sm text-slate-700 font-medium">
            اكتب عبارة البحث واختر «معلومات» أو «صور حقيقية»
          </p>
        </div>
      )}
    </div>
  );
}
