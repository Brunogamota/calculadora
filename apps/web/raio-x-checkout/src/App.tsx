import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  MoveRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ExternalLink,
  Eye,
  Globe2,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Menu,
  Monitor,
  MousePointer2,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  WifiOff,
  X,
} from "lucide-react";
import type { FormEvent } from "react";

type Screen = "landing" | "running" | "result" | "waf" | "connection";

type Step = {
  label: string;
  detail: string;
};

const steps: Step[] = [
  { label: "Identificando a loja", detail: "Plataforma e estrutura encontradas" },
  { label: "Abrindo um produto", detail: "Produto disponível localizado" },
  { label: "Adicionando ao carrinho", detail: "Carrinho criado com sucesso" },
  { label: "Indo para o checkout", detail: "Fluxo de compra iniciado" },
  { label: "Lendo os meios de pagamento", detail: "Pix, cartão e parcelamento" },
  { label: "Repetindo no celular", detail: "Teste em uma tela de 390 px" },
  { label: "Montando o relatório", detail: "Priorizando o que afeta vendas" },
];

type Severidade = "crítico" | "atenção";

/* Os sete itens da grade. O texto e o do markup do desenho, que e mais longo
   que o do array CHECKS do script — o markup e o que aparece na tela. */
const checks = [
  { area: "loja", n: "01", t: "A loja abre", d: "Plataforma, tema e quanto tempo passa até a vitrine aparecer de verdade." },
  { area: "produto", n: "02", t: "O produto", d: "Preço, parcelamento e o que está escrito sobre pagamento antes de qualquer clique." },
  { area: "carrinho", n: "03", t: "O carrinho", d: "Quantos cliques até ele montar, e o que a tela não conta sobre a compra." },
  { area: "checkout", n: "04", t: "O checkout", d: "Quantas telas, quantos campos, e em qual delas o cliente trava." },
  { area: "meios", n: "05", t: "Os meios de pagamento", d: "Quais existem, em que tela aparecem, e o que some quando a compra é no celular. Quase sempre o cliente decide como vai pagar antes da loja dizer o que aceita." },
  { area: "celular", n: "06", t: "O celular", d: "A mesma compra num aparelho de verdade, do começo, em paralelo com o computador." },
  { area: "fatura", n: "07", t: "A fatura", d: "O nome que vai chegar no extrato de quem comprou de você, trinta dias depois. É o motivo mais comum de contestação em compra legítima." },
];

/* Achados de auditorias reais, sem o nome das lojas. */
const proof: { sev: Severidade; t: string; d: string }[] = [
  { sev: "crítico", t: "Nove toques até pagar, no celular", d: "Loja de moda, R$ 1,2 milhão por mês. No computador eram quatro." },
  { sev: "crítico", t: "O Pix aparecia depois do cartão", d: "Suplementos. A loja pagava taxa de cartão em venda que sairia no Pix." },
  { sev: "atenção", t: "A fatura dizia o nome do gateway", d: "Pet shop. Um em cada onze pedidos virava contestação de compra legítima." },
];

/* Duas severidades, duas cores da paleta. Crítico e o acento, atenção e a
   tinta. Nao existe uma terceira: verde e amarelo nao entram no projeto. */
function Severidade({ sev }: { sev: Severidade }) {
  return <span className={`severity ${sev === "crítico" ? "critico" : "atencao"}`}>{sev === "crítico" ? "Crítico" : "Atenção"}</span>;
}

/* O menu de estados serve para gravar video e revisar sem digitar endereco
   falso. Nao aparece para quem usa o produto: so em desenvolvimento, ou com
   ?estados=1 na URL, que e como abrir para gravar em producao. */
function mostrarEstados(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return new URLSearchParams(window.location.search).get("estados") === "1";
  } catch {
    return false;
  }
}

function Logo() {
  return (
    <button className="logo" onClick={() => window.location.reload()} aria-label="Voltar ao início">
      <span className="logo-mark"><span /></span>
      <span>reborn</span>
    </button>
  );
}

function Spinner() {
  return <LoaderCircle className="spinner" size={18} aria-hidden="true" />;
}

function Header({ screen, onNavigate }: { screen: Screen; onNavigate: (screen: Screen) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={`site-header ${screen !== "landing" ? "app-header" : ""}`}>
      <div className="header-inner">
        <Logo />
        <nav className="desktop-nav" aria-label="Navegação principal">
          {screen === "landing" ? (
            <>
              <a href="#verifica">O que verificamos</a>
              <a href="#quem">Quem faz</a>
              <a href="#topo" className="nav-forte">Entrar</a>
            </>
          ) : (
            <button className="back-link" onClick={() => onNavigate("landing")}><ArrowLeft size={15} /> Nova análise</button>
          )}
        </nav>
        {mostrarEstados() && (
        <details className="state-menu">
          <summary>Ver estados <ChevronDown size={14} /></summary>
          <div className="state-popover">
            <button onClick={() => onNavigate("running")}><Monitor size={15} /> Execução ao vivo</button>
            <button onClick={() => onNavigate("result")}><Eye size={15} /> Resultado</button>
            <button onClick={() => onNavigate("waf")}><ShieldCheck size={15} /> Loja bloqueou o robô</button>
            <button onClick={() => onNavigate("connection")}><WifiOff size={15} /> Conexão interrompida</button>
          </div>
        </details>
        )}
        <button className="mobile-menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Abrir menu">
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {menuOpen && (
        <div className="mobile-menu">
          <a href="#verifica" onClick={() => setMenuOpen(false)}>O que verificamos</a>
          <a href="#quem" onClick={() => setMenuOpen(false)}>Quem faz</a>
          <a href="#topo" onClick={() => setMenuOpen(false)}>Entrar</a>
        </div>
      )}
    </header>
  );
}

function UrlForm({ onStart }: { onStart: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const ph = useRotacao(PLACEHOLDERS.length, 3000);

  const limpo = url.trim();
  const valido = /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(limpo.replace(/^https?:\/\//, ""));
  const invalido = tocado && limpo.length > 0 && !valido;
  const digitando = limpo.length > 0;

  const enviar = (event: FormEvent) => {
    event.preventDefault();
    setTocado(true);
    if (!valido) return;
    setEnviando(true);
    window.setTimeout(() => onStart(limpo), 700);
  };

  return (
    <form className="url-form" onSubmit={enviar} noValidate>
      <svg aria-hidden="true" className="goo-defs">
        <defs>
          <filter id="rbGoo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -15" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>
      <div className="url-row">
        <div className="url-pill">
          <input
            type="text"
            aria-label="endereço da sua loja"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => setTocado(true)}
            disabled={enviando}
          />
          {limpo.length === 0 && (
            <div className="url-placeholder" aria-hidden="true" key={ph}>{PLACEHOLDERS[ph]}</div>
          )}
        </div>
        <button type="submit" className={`send-button ${digitando ? "pronto" : ""}`} aria-label="Auditar meu checkout" disabled={enviando}>
          {enviando ? <span className="send-spinner" /> : <MoveRight size={20} aria-hidden="true" />}
        </button>
      </div>
      {invalido ? (
        <p className="url-invalid">
          <span className="url-invalid-dot" />
          Não consegui ler esse endereço. Tenta assim: minhaloja.com.br
        </p>
      ) : (
        <p className="url-helper">
          {digitando
            ? "Vamos abrir esse endereço agora. Você acompanha cada passo."
            : "Leva de 40 a 90 segundos. Sem cadastro, sem instalar nada."}
        </p>
      )}
    </form>
  );
}

/* O campo do heroi: pilula escura fluida com o botao circular ao lado, os dois
   sob o filtro goo, que os faz se esticar um na direcao do outro. A seta so
   fica rosa quando ha texto — e o unico sinal de que da para enviar. */
const PLACEHOLDERS = ["casaverde.com.br", "minhaloja.com.br", "lojinhadabia.com", "suamarca.com.br/loja"];

const ROTATIVAS = [
  "o Pix escondido no fim",
  "o parcelamento sem valor",
  "os toques a mais no celular",
  "a fatura sem o seu nome",
  "o frete que só aparece depois",
];

function useRotacao(total: number, ms: number): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((n) => (n + 1) % total), ms);
    return () => window.clearInterval(t);
  }, [total, ms]);
  return i;
}

function HeroTitle() {
  const atual = useRotacao(ROTATIVAS.length, 2200);
  return (
    <h1 className="hero-title">
      <span className="hero-title-fixa">O robô compra na sua loja e acha</span>
      <span className="hero-title-rot">
        {ROTATIVAS.map((texto, i) => (
          <span
            key={texto}
            style={{ opacity: i === atual ? 1 : 0, transform: `translateY(${i === atual ? 0 : atual > i ? -140 : 140}%)` }}
          >
            {texto}
          </span>
        ))}
      </span>
    </h1>
  );
}

/* A borda que acende seguindo o cursor. Um angulo registrado com @property para
   ser interpolavel, e um ouvinte que so escreve duas variaveis — sem redesenhar
   nada. Com movimento reduzido, o ouvinte nem e registrado. */
function useBordaQueAcende() {
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const mover = (x: number, y: number) => {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-glow]"))) {
        const r = el.getBoundingClientRect();
        const perto = x > r.left - 90 && x < r.right + 90 && y > r.top - 90 && y < r.bottom + 90;
        if (!perto) { el.style.setProperty("--rbGlow", "0"); continue; }
        el.style.setProperty("--rbGlow", "1");
        const alvo = (180 * Math.atan2(y - (r.top + r.height / 2), x - (r.left + r.width / 2))) / Math.PI + 90;
        const atual = Number.parseFloat(el.dataset["angle"] ?? "0");
        const proximo = atual + (((alvo - atual + 180) % 360) - 180);
        el.dataset["angle"] = String(proximo);
        el.style.setProperty("--rbA", `${proximo.toFixed(1)}deg`);
      }
    };
    const porPonteiro = (e: PointerEvent) => mover(e.clientX, e.clientY);
    const porFoco = (e: FocusEvent) => {
      const el = (e.target as HTMLElement)?.closest?.("[data-glow]") as HTMLElement | null;
      if (!el) return;
      const atual = Number.parseFloat(el.dataset["angle"] ?? "0") + 300;
      el.dataset["angle"] = String(atual);
      el.style.setProperty("--rbA", `${atual.toFixed(1)}deg`);
    };
    document.addEventListener("pointermove", porPonteiro, { passive: true });
    document.addEventListener("focusin", porFoco);
    return () => {
      document.removeEventListener("pointermove", porPonteiro);
      document.removeEventListener("focusin", porFoco);
    };
  }, []);
}

/* Cada secao entra a 94% de escala com canto arredondado e abre ate encostar
   nas bordas. Calculado da posicao real da secao e escrito direto no elemento:
   nao sequestra a roda do mouse, entao voltar, teclado e gesto continuam
   funcionando. */
function useRevelacao() {
  useEffect(() => {
    const revelar = () => {
      const vh = window.innerHeight || 800;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"))) {
        const p = Math.max(0, Math.min(1, (vh - el.getBoundingClientRect().top) / (vh * 0.72)));
        const e = 1 - (1 - p) ** 3;
        if (e > 0.995) {
          el.style.transform = "";
          el.style.opacity = "";
          el.style.borderRadius = "";
          el.style.overflow = "";
        } else {
          el.style.transform = `scale(${(0.94 + 0.06 * e).toFixed(4)})`;
          el.style.opacity = (0.45 + 0.55 * e).toFixed(3);
          el.style.borderRadius = `${(28 - 28 * e).toFixed(1)}px`;
          el.style.overflow = "hidden";
        }
      }
    };
    revelar();
    const t = window.setInterval(revelar, 500);
    window.addEventListener("scroll", revelar, { passive: true });
    window.addEventListener("resize", revelar);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("scroll", revelar);
      window.removeEventListener("resize", revelar);
    };
  }, []);
}

function Landing({ onStart }: { onStart: (url: string) => void }) {
  useBordaQueAcende();
  useRevelacao();

  return (
    <main id="topo">
      <section className="hero">
        <div className="hero-content">
          <div className="hero-badge">
            Auditoria gratuita, de 40 a 90 segundos
            <ArrowRight size={14} aria-hidden="true" />
          </div>
          <HeroTitle />
          <p className="hero-copy">Ele abre a sua loja, escolhe um produto, coloca no carrinho e vai até a tela de pagamento. Você assiste. No fim, a gente diz onde a venda está se perdendo.</p>
          <UrlForm onStart={onStart} />
        </div>
        <a className="scroll-cue mono" href="#verifica">
          <span>ROLE PARA VER O QUE ELE OLHA</span>
          <ChevronDown size={15} aria-hidden="true" />
        </a>
      </section>

      <section id="verifica" className="checks-section" data-reveal>
        <div className="section-shell">
          <div className="checks-heading">
            <h2>O que o robô olha antes de te dar a nota</h2>
            <p>Ele não lê o seu código nem pede acesso a nada. Faz o que um cliente faria, do lado de fora, e anota onde a compra fica difícil.</p>
          </div>
          <div className="checks-grid" data-bento>
            {checks.map((c) => (
              <article className={`check-card area-${c.area}`} key={c.n} data-glow tabIndex={0}>
                <span className="check-number mono">{c.n}</span>
                <h3>{c.t}</h3>
                <p>{c.d}</p>
                {c.area === "meios" && <span className="check-flag">onde mora a maioria dos achados</span>}
                {c.area === "checkout" && (
                  <div className="check-telas" aria-hidden="true">
                    <span className="mono">1</span><i>›</i>
                    <span className="mono">2</span><i>›</i>
                    <span className="mono">3</span><i>›</i>
                    <span className="mono ultima">4</span>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="proof-section" data-reveal>
        <div className="section-shell">
          <div className="proof-heading">
            <h2>O que a gente já encontrou em outras lojas</h2>
            <p>Achados reais de auditorias recentes, sem o nome das lojas.</p>
          </div>
          <div className="proof-grid">
            {proof.map((p) => (
              <article className="proof-card" key={p.t}>
                <Severidade sev={p.sev} />
                <h3>{p.t}</h3>
                <p>{p.d}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="quem" className="about-section" data-reveal>
        <div className="about-card">
          <div className="about-copy">
            <h2>A Reborn cuida do que acontece depois que a venda é aprovada</h2>
            <p>Somos infraestrutura de pagamento. Aceitar o pagamento é a parte fácil: o problema começa na conciliação, na contestação, no repasse e no nome que aparece na fatura do seu cliente. Esta auditoria existe porque quase todo checkout perde venda antes de chegar lá.</p>
          </div>
          <button type="button" className="pill-button">
            <span>Falar com a Reborn</span>
            <span className="button-icon"><ArrowUpRight size={15} aria-hidden="true" /></span>
          </button>
        </div>
      </section>
    </main>
  );
}

function ShareButton() {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const data = { title: "Raio-X do Checkout", text: "Veja a análise deste checkout", url: window.location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // The user may cancel the native share sheet.
    }
  };
  return <button className="share-button" onClick={share}>{copied ? <Check size={16} /> : <Link2 size={16} />}{copied ? "Link copiado" : "Compartilhar"}</button>;
}

function StoreBrowser({ progress, paused = false }: { progress: number; paused?: boolean }) {
  const stage = progress < 2 ? "collection" : progress < 4 ? "product" : "checkout";
  return (
    <div className={`store-browser ${paused ? "paused" : ""}`}>
      <div className="browser-chrome">
        <div className="traffic-lights"><i /><i /><i /></div>
        <div className="browser-address"><LockKeyhole size={12} /> lojademonstracao.com.br/{stage === "product" ? "produtos/tenis" : stage === "checkout" ? "checkout" : "colecao"}</div>
        <RefreshCw size={14} />
      </div>
      <div className="store-page">
        <div className="demo-store-nav"><b>ATELIÊ</b><span>Novidades&nbsp;&nbsp;&nbsp; Feminino&nbsp;&nbsp;&nbsp; Masculino</span><div><Search size={16} /><span className="bag-icon">0</span></div></div>
        {stage === "collection" && (
          <div className="collection-view">
            <div className="collection-title"><small>NOVA COLEÇÃO</small><h3>Essenciais para<br />todos os dias</h3><button>Ver coleção</button></div>
            <div className="product-visual coral"><span>Tênis Orla</span></div>
            <div className="product-visual cream"><span>Bolsa Norte</span></div>
          </div>
        )}
        {stage === "product" && (
          <div className="product-view">
            <div className="shoe-visual"><div className="shoe">N</div></div>
            <div className="product-info"><small>NOVIDADE</small><h3>Tênis Orla</h3><p className="price">R$ 489,90</p><p>Escolha o tamanho</p><div className="sizes"><span>36</span><span>37</span><span>38</span><span>39</span></div><button>Adicionar à sacola</button></div>
          </div>
        )}
        {stage === "checkout" && (
          <div className="checkout-view">
            <div className="checkout-main"><p className="step-caption">ENTREGA &gt; PAGAMENTO</p><h3>Como você quer pagar?</h3><div className="payment-option"><Circle size={14} /> Cartão de crédito <span>›</span></div><div className="payment-option muted-payment"><Circle size={14} /> Pix <small>desconto no próximo passo</small><span>›</span></div></div>
            <div className="order-summary"><h4>Resumo</h4><div><span>Tênis Orla</span><b>R$ 489,90</b></div><div><span>Entrega</span><b>R$ 18,00</b></div><hr /><div><span>Total</span><b>R$ 507,90</b></div><button>Continuar</button></div>
          </div>
        )}
        {!paused && <div className={`robot-cursor cursor-stage-${Math.min(progress, 6)}`}><MousePointer2 fill="currentColor" size={26} /><span>robô</span></div>}
        {paused && <div className="paused-overlay"><WifiOff size={22} /><span>Imagem pausada em 00:31</span></div>}
      </div>
      <div className="browser-footer"><span><span className={`live-dot ${paused ? "gray" : ""}`} /> {paused ? "transmissão pausada" : "transmissão ao vivo"}</span><span className="mono">1280 × 720</span></div>
    </div>
  );
}

function FindingsFeed({ progress }: { progress: number }) {
  return (
    <div className="findings-feed">
      <div className="panel-title"><span>Achados até agora</span><span>{progress >= 5 ? "2" : progress >= 3 ? "1" : "0"}</span></div>
      {progress < 3 && <div className="empty-finding"><Search size={18} /><p>Os achados aparecem aqui enquanto o robô avança.</p></div>}
      {progress >= 3 && (
        <article className="live-finding"><span className="severity critical">Importante</span><h4>O desconto do Pix só aparece no fim</h4><p>Quem está comparando formas de pagamento não vê a vantagem antes de entrar no checkout.</p></article>
      )}
      {progress >= 5 && (
        <article className="live-finding new-finding"><span className="severity attention">Atenção</span><h4>No celular, são nove toques até pagar</h4><p>No computador, o mesmo caminho leva seis.</p></article>
      )}
    </div>
  );
}

function Running({ onComplete, url }: { onComplete: () => void; url: string }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= steps.length - 1) {
          window.clearInterval(timer);
          window.setTimeout(onComplete, 1400);
          return current;
        }
        return current + 1;
      });
    }, 2700);
    return () => window.clearInterval(timer);
  }, [onComplete]);

  return (
    <main className="workspace-page">
      <div className="workspace-topbar">
        <div><span className="running-pill"><Spinner /> Análise em andamento</span><div><h1>Analisando seu checkout</h1><p>{url || "lojademonstracao.com.br"}</p></div></div>
        <ShareButton />
      </div>
      <div className="mobile-current-step"><Spinner /><span><small>Agora</small>{steps[progress].label}</span><b>{progress + 1}/{steps.length}</b></div>
      <div className="audit-workspace">
        <section className="browser-column">
          <StoreBrowser progress={progress} />
          <div className="browser-caption"><span>O robô está navegando como um cliente comum.</span><span className="mono">00:{String(Math.min(59, progress * 9 + 4)).padStart(2, "0")}</span></div>
        </section>
        <aside className="audit-sidebar">
          <div className="steps-panel">
            <div className="panel-title"><span>Etapas da análise</span><span>{progress + 1} de {steps.length}</span></div>
            <div className="step-list">
              {steps.map((step, index) => {
                const status = index < progress ? "done" : index === progress ? "active" : "waiting";
                return <div className={`step-row ${status}`} key={step.label}><span className="step-status">{status === "done" ? <Check size={14} /> : status === "active" ? <Spinner /> : <Circle size={11} />}</span><div><h3>{step.label}</h3><p>{status === "done" ? step.detail : status === "active" ? "Robô trabalhando agora" : "Aguardando"}</p></div></div>;
              })}
            </div>
          </div>
          <FindingsFeed progress={progress} />
        </aside>
      </div>
      <button className="skip-button" onClick={onComplete}>Ir para o resultado desta demonstração</button>
    </main>
  );
}

function EvidenceVisual() {
  return (
    <div className="evidence-visual">
      <div className="evidence-toolbar"><span /><span /><span /><p>lojademonstracao.com.br/checkout</p></div>
      <div className="evidence-content">
        <div className="evidence-checkout"><small>Pagamento</small><h4>Escolha uma forma de pagamento</h4><div>Cartão de crédito <span>›</span></div><div className="evidence-highlight">Pix <b>5% de desconto</b><span>›</span></div></div>
        <div className="evidence-note"><span>01</span><p>O desconto aparece pela primeira vez nesta tela, depois de 7 ações.</p></div>
      </div>
    </div>
  );
}

const lockedFindings = [
  { severity: "Importante", title: "Quem compra pelo celular precisa de nove toques até pagar", tag: "celular" },
  { severity: "Atenção", title: "O parcelamento não mostra o valor de cada parcela", tag: "clareza" },
  { severity: "Atenção", title: "O nome que aparece na fatura não lembra o nome da loja", tag: "confiança" },
];

function FindingDetail({ item, index }: { item: typeof lockedFindings[number]; index: number }) {
  return (
    <article className="unlocked-finding">
      <div className="finding-index">0{index + 2}</div>
      <div><div className="finding-meta"><span className={`severity ${index === 0 ? "critical" : "attention"}`}>{item.severity}</span><span>{item.tag}</span></div><h3>{item.title}</h3><p>{index === 0 ? "O menu móvel, o cálculo de frete e duas confirmações extras deixam o caminho 50% mais longo que no computador." : index === 1 ? "O cliente vê apenas o total da compra. O valor mensal só é revelado depois que ele escolhe o cartão." : "A cobrança usa “PG*SERVICOSBR”. Sem reconhecer a compra, o cliente pode contestar o pagamento."}</p><div className="recommendation"><CheckCircle2 size={17} /><span><b>O que fazer</b>{index === 0 ? "Reduza as confirmações antes da etapa de pagamento." : index === 1 ? "Mostre 10× de R$ 50,79 já na página do produto." : "Avise o nome da fatura ao lado do botão de compra."}</span></div></div>
    </article>
  );
}

function Result({ onRestart }: { onRestart: () => void }) {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [sending, setSending] = useState(false);

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setEmailError("Digite um e-mail válido para abrir o relatório.");
      return;
    }
    setSending(true);
    window.setTimeout(() => { setSending(false); setUnlocked(true); }, 900);
  };

  return (
    <main className="result-page">
      <div className="result-heading">
        <div><span className="complete-pill"><Check size={14} /> Análise concluída</span><p className="result-domain"><Globe2 size={14} /> lojademonstracao.com.br</p></div>
        <ShareButton />
      </div>

      <section className="score-card">
        <div className="score-gauge"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="53" /><circle className="score-progress" cx="60" cy="60" r="53" /></svg><div><strong>64</strong><span>de 100</span></div></div>
        <div className="score-copy"><p>Nota do checkout</p><h1>Seu checkout funciona.<br />Mas pede esforço demais.</h1><span>Encontramos 4 pontos que podem fazer o cliente desistir antes de pagar.</span></div>
        <div className="score-summary"><div><b>1</b><span>importante</span></div><div><b>3</b><span>atenção</span></div><div><b>7</b><span>etapas testadas</span></div></div>
      </section>

      <section className="report-section">
        <div className="report-title"><div><p className="section-kicker">Primeiro achado</p><h2>O desconto do Pix chega tarde demais.</h2></div><span className="severity critical">Importante</span></div>
        <div className="primary-finding-grid">
          <div className="finding-explanation"><p>O cliente só descobre os 5% de desconto depois de abrir o carrinho, informar o CEP e entrar na etapa de pagamento.</p><p>Até lá, quem compara preço com outra loja acredita que vai pagar <b>R$ 489,90</b>, não <b>R$ 465,41</b>.</p><div className="impact-box"><span>Por que isso pesa</span><p>O Pix perde o poder de ajudar a decisão justamente quando o cliente ainda está comparando.</p></div></div>
          <EvidenceVisual />
        </div>
      </section>

      <section className={`more-findings ${unlocked ? "is-unlocked" : "is-locked"}`}>
        <div className="more-heading"><div><p className="section-kicker">Mais 3 achados</p><h2>O restante do diagnóstico</h2></div>{unlocked && <span className="opened-badge"><Check size={14} /> Relatório aberto</span>}</div>
        {unlocked ? (
          <div className="unlocked-list">{lockedFindings.map((item, index) => <FindingDetail item={item} index={index} key={item.title} />)}</div>
        ) : (
          <div className="sealed-list">
            {lockedFindings.map((item, index) => (
              <article className="sealed-finding" key={item.title}>
                <span className="sealed-number">0{index + 2}</span>
                <div><span className={`severity ${index === 0 ? "critical" : "attention"}`}>{item.severity}</span><h3>{item.title}</h3><div className="redacted-lines"><i /><i /><i /></div></div>
                <div className="seal"><LockKeyhole size={16} /><span>Explicação e correção</span></div>
              </article>
            ))}
            <form className="unlock-card" onSubmit={submitEmail} noValidate>
              <div className="unlock-icon"><Mail size={21} /></div>
              <div className="unlock-copy"><h3>Receba o diagnóstico completo</h3><p>Abra as evidências e veja o que mudar primeiro. Também enviamos uma cópia deste relatório para o seu e-mail.</p></div>
              <div className={`email-field ${emailError ? "error" : ""}`}><input type="email" placeholder="seu@ecommerce.com.br" value={email} onChange={(event) => { setEmail(event.target.value); setEmailError(""); }} aria-label="Seu e-mail" /><button type="submit" disabled={sending}>{sending ? <Spinner /> : "Abrir diagnóstico"}</button></div>
              <p className="email-message">{emailError || "Sem sequência de e-mails. Só o relatório e uma conversa, se você quiser."}</p>
            </form>
          </div>
        )}
      </section>
      <div className="result-footer"><span>Auditoria feita pelo Raio-X do Checkout, da Reborn.</span><button onClick={onRestart}><RefreshCw size={15} /> Analisar outra loja</button></div>
    </main>
  );
}

function ExceptionState({ type, onRetry, onRestart }: { type: "waf" | "connection"; onRetry: () => void; onRestart: () => void }) {
  const isWaf = type === "waf";
  return (
    <main className="workspace-page exception-page">
      <div className="workspace-topbar"><div><span className="info-pill">Análise interrompida</span><div><h1>{isWaf ? "A loja não deixou o robô entrar" : "Perdemos a conexão com a loja"}</h1><p>lojademonstracao.com.br</p></div></div><ShareButton /></div>
      <div className="exception-layout">
        <StoreBrowser progress={isWaf ? 0 : 4} paused />
        <section className="exception-content">
          <div className="exception-icon">{isWaf ? <ShieldCheck size={29} /> : <WifiOff size={29} />}</div>
          <p className="section-kicker">Isso também diz algo sobre a loja</p>
          <h2>{isWaf ? "A proteção bloqueou uma visita que parecia automatizada." : "A página parou de responder durante o pagamento."}</h2>
          <p>{isWaf ? "Algumas lojas usam uma barreira contra robôs. Ela protege contra abuso, mas também pode bloquear comparadores de preço, ferramentas de acessibilidade e outros acessos legítimos." : "O robô chegou até o checkout, mas a loja deixou de responder por mais de 20 segundos. Um cliente nessa situação provavelmente fecharia a página."}</p>
          <div className="captured-data"><h3>O que conseguimos registrar</h3><div><span><Check size={14} /> Página inicial abriu normalmente</span><span>{isWaf ? <X size={14} /> : <Check size={14} />} {isWaf ? "Acesso ao produto foi negado" : "Produto e carrinho carregaram"}</span><span>{isWaf ? <Circle size={12} /> : <X size={14} />} {isWaf ? "Checkout não pôde ser testado" : "Checkout parou na etapa de pagamento"}</span></div></div>
          <div className="exception-actions"><button className="primary-button" onClick={onRetry}><RefreshCw size={16} /> Tentar novamente</button><button className="secondary-button" onClick={onRestart}>Testar outro endereço</button></div>
          <p className="support-note">Se a loja for sua, você pode liberar temporariamente o acesso do robô e repetir a análise.</p>
        </section>
      </div>
    </main>
  );
}

function Footer() {
  return <footer className="site-footer"><div><Logo /><p>Infraestrutura para o pagamento continuar funcionando depois da aprovação.</p></div><span>Reborn © 2026</span></footer>;
}

function App() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [storeUrl, setStoreUrl] = useState("");

  const start = (url: string) => { setStoreUrl(url); setScreen("running"); window.scrollTo(0, 0); };
  const navigate = (next: Screen) => { setScreen(next); window.scrollTo(0, 0); };

  return (
    <div className="app">
      <Header screen={screen} onNavigate={navigate} />
      {screen === "landing" && <><Landing onStart={start} /><Footer /></>}
      {screen === "running" && <Running url={storeUrl} onComplete={() => navigate("result")} />}
      {screen === "result" && <Result onRestart={() => navigate("landing")} />}
      {screen === "waf" && <ExceptionState type="waf" onRetry={() => navigate("running")} onRestart={() => navigate("landing")} />}
      {screen === "connection" && <ExceptionState type="connection" onRetry={() => navigate("running")} onRestart={() => navigate("landing")} />}
    </div>
  );
}

export default App;
