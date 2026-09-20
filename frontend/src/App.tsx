import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  CircleAlert,
  Cpu,
  Image as ImageIcon,
  Layers3,
  Play,
  RefreshCcw,
  Search,
  Upload,
} from "lucide-react";
import { analyzeImage, fetchEngines } from "./api";
import type { AnalysisResponse, EngineInfo, EngineResult } from "./types";

function statusLabel(engine: EngineInfo) {
  if (engine.availability === "ready") return "Pronto";
  if (engine.availability === "requires_weights") return "Requer pesos";
  if (engine.availability === "missing_dependency") return "Dependência ausente";
  return "Desativado";
}

function ResultCard({
  result,
  engine,
  original,
}: {
  result: EngineResult;
  engine?: EngineInfo;
  original: string;
}) {
  const image = result.overlay_base64 || original;
  const uniqueLabels = Array.from(new Set(result.detections.map((x) => x.label)));

  return (
    <article className="result-card">
      <div className="result-head">
        <div>
          <h3>{engine?.name ?? result.engine_id}</h3>
          <p>{engine?.family}</p>
        </div>
        <span className={"state " + result.state}>{result.state}</span>
      </div>

      <div className="result-image">
        <img src={image} alt={"Resultado " + (engine?.name ?? result.engine_id)} />
      </div>

      <div className="result-metrics">
        <div><strong>{result.elapsed_ms.toFixed(0)}</strong><span>ms</span></div>
        <div><strong>{result.detections.length}</strong><span>regiões</span></div>
        <div>
          <strong>
            {result.affected_area_percent == null
              ? "—"
              : result.affected_area_percent.toFixed(2) + "%"}
          </strong>
          <span>área</span>
        </div>
      </div>

      {uniqueLabels.length > 0 && (
        <div className="chips">
          {uniqueLabels.map((label) => <span key={label}>{label}</span>)}
        </div>
      )}

      {(result.note || result.error) && (
        <p className={result.error ? "result-error" : "result-note"}>
          {result.error || result.note}
        </p>
      )}
    </article>
  );
}

export default function App() {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [confidence, setConfidence] = useState(0.25);
  const inputRef = useRef<HTMLInputElement>(null);

  async function loadCatalog() {
    setCatalogLoading(true);
    setError("");
    try {
      const data = await fetchEngines();
      setEngines(data);
      setSelected(new Set(data.filter((x) => x.availability === "ready").map((x) => x.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar catálogo.");
    } finally {
      setCatalogLoading(false);
    }
  }

  useEffect(() => {
    void loadCatalog();
  }, []);

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return engines;
    return engines.filter((engine) =>
      [engine.name, engine.family, engine.task, engine.backend, engine.description]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [engines, query]);

  const engineMap = useMemo(
    () => Object.fromEntries(engines.map((engine) => [engine.id, engine])),
    [engines],
  );

  function toggle(engine: EngineInfo) {
    if (engine.availability !== "ready") return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(engine.id)) next.delete(engine.id);
      else next.add(engine.id);
      return next;
    });
  }

  function chooseFile(candidate?: File) {
    if (!candidate) return;
    if (!candidate.type.startsWith("image/")) {
      setError("Selecione um arquivo de imagem.");
      return;
    }
    setFile(candidate);
    setAnalysis(null);
    setError("");
  }

  async function run() {
    if (!file) {
      setError("Adicione uma imagem para iniciar.");
      return;
    }
    if (selected.size === 0) {
      setError("Selecione pelo menos um motor disponível.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await analyzeImage(file, Array.from(selected), confidence);
      setAnalysis(result);
      setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na análise.");
    } finally {
      setLoading(false);
    }
  }

  const readyCount = engines.filter((x) => x.availability === "ready").length;
  const pathologyReady = engines.filter((x) => x.pathology_ready && x.availability === "ready").length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Layers3 size={22} /></div>
          <div>
            <strong>SHM Multi-Engine Lab</strong>
            <span>Visual pathology benchmark workspace</span>
          </div>
        </div>
        <div className="top-stats">
          <span><Cpu size={16} /> {engines.length} motores</span>
          <span><CheckCircle2 size={16} /> {readyCount} prontos</span>
          <span><Activity size={16} /> {pathologyReady} com pesos SHM</span>
        </div>
      </header>

      <main>
        <section className="hero">
          <div>
            <span className="eyebrow">INSPEÇÃO VISUAL · OAEs · SHM</span>
            <h1>Uma imagem. Múltiplos motores. Uma comparação controlada.</h1>
            <p>
              Execute a mesma inspeção em detectores, segmentadores e modelos foundation,
              mantendo disponibilidade, tempo, regiões detectadas e área afetada no mesmo painel.
            </p>
          </div>
          <div className="hero-badge">
            <CircleAlert size={20} />
            <span>Comparação visual não substitui validação com ground truth.</span>
          </div>
        </section>

        <section className="workspace-grid">
          <div className="panel upload-panel">
            <div className="panel-title">
              <div><ImageIcon size={19} /><h2>Imagem de entrada</h2></div>
              {file && <span className="file-pill">{file.name}</span>}
            </div>

            <div
              className={"dropzone " + (preview ? "has-image" : "")}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                chooseFile(event.dataTransfer.files[0]);
              }}
            >
              {preview ? (
                <img src={preview} alt="Pré-visualização da inspeção" />
              ) : (
                <div>
                  <Upload size={34} />
                  <strong>Arraste a imagem de inspeção</strong>
                  <span>ou clique para selecionar</span>
                </div>
              )}
            </div>
            <input
              ref={inputRef}
              hidden
              type="file"
              accept="image/*"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />

            <div className="control-row">
              <label>
                <span>Confiança mínima</span>
                <strong>{confidence.toFixed(2)}</strong>
              </label>
              <input
                type="range"
                min="0.05"
                max="0.90"
                step="0.05"
                value={confidence}
                onChange={(event) => setConfidence(Number(event.target.value))}
              />
            </div>

            <button className="run-button" onClick={() => void run()} disabled={loading}>
              {loading ? <RefreshCcw className="spin" size={18} /> : <Play size={18} />}
              {loading ? "Executando motores..." : "Analisar com " + selected.size + " motor(es)"}
            </button>
            {error && <p className="global-error">{error}</p>}
          </div>

          <div className="panel catalog-panel">
            <div className="panel-title catalog-title">
              <div><Cpu size={19} /><h2>Catálogo de motores</h2></div>
              <div className="catalog-actions">
                <button onClick={() => setSelected(new Set(engines.filter((x) => x.availability === "ready").map((x) => x.id)))}>
                  Selecionar prontos
                </button>
                <button onClick={() => setSelected(new Set())}>Limpar</button>
              </div>
            </div>

            <div className="searchbox">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar YOLO, transformer, segmentação..."
              />
            </div>

            <div className="engine-list">
              {catalogLoading && <p className="muted">Carregando catálogo...</p>}
              {filtered.map((engine) => (
                <button
                  key={engine.id}
                  className={[
                    "engine-row",
                    selected.has(engine.id) ? "selected" : "",
                    engine.availability !== "ready" ? "unavailable" : "",
                  ].join(" ")}
                  onClick={() => toggle(engine)}
                  title={engine.status_reason ?? engine.description}
                >
                  <span className="selector">{selected.has(engine.id) ? "✓" : ""}</span>
                  <span className="engine-copy">
                    <strong>{engine.name}</strong>
                    <small>{engine.family} · {engine.task}</small>
                  </span>
                  <span className={"availability " + engine.availability}>
                    {statusLabel(engine)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {analysis && (
          <section id="results" className="results-section">
            <div className="results-heading">
              <div>
                <span className="eyebrow">RESULTADOS NORMALIZADOS</span>
                <h2>Comparação lado a lado</h2>
                <p>{analysis.filename} · {analysis.width} × {analysis.height}px</p>
              </div>
              <div className="warnings">
                {analysis.warnings.map((warning) => <span key={warning}>{warning}</span>)}
              </div>
            </div>

            <div className="result-grid">
              <article className="result-card original-card">
                <div className="result-head">
                  <div><h3>Original</h3><p>Imagem de entrada comum</p></div>
                  <span className="state ok">input</span>
                </div>
                <div className="result-image">
                  <img src={preview} alt="Imagem original" />
                </div>
              </article>
              {analysis.results.map((result) => (
                <ResultCard
                  key={result.engine_id}
                  result={result}
                  engine={engineMap[result.engine_id]}
                  original={preview}
                />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
