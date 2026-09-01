import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
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

type Severity = "alta" | "média";

type Step = {
  label: string;
  /** Quanto a etapa leva. Vira o tempo ao lado do rotulo quando ela conclui. */
  seconds: number;
  page: string;
  url: string;
};

type Finding = {
  severity: Severity;
  category: string;
  /** Indice da etapa em que o achado aparece, para ele entrar ao vivo. */
  at: number;
  title: string;
  meta: string;
  body: string;
  fix: string;
};

const DEMO_STORE = "casaverdecosmeticos.com.br";

/* As sete etapas com a duracao que cada uma leva de verdade. O tempo por etapa
   e o que faz a barra parecer medida em vez de decorativa: 8.7s lendo meios de
   pagamento e 11.2s repetindo no celular sao as duas mais caras, e e util que
   isso apareca. */
const steps: Step[] = [
  { label: "identificando a loja", seconds: 5.2, page: "home", url: DEMO_STORE },
  { label: "abrindo um produto", seconds: 3.8, page: "produto", url: `${DEMO_STORE}/serum-vitamina-c` },
  { label: "adicionando ao carrinho", seconds: 4.1, page: "carrinho", url: `${DEMO_STORE}/carrinho` },
  { label: "indo pro checkout", seconds: 6.4, page: "checkout", url: `${DEMO_STORE}/checkout` },
  { label: "lendo os meios de pagamento", seconds: 8.7, page: "pagamento", url: `${DEMO_STORE}/checkout/pagamento` },
  { label: "repetindo no celular", seconds: 11.2, page: "pagamento", url: `${DEMO_STORE}/checkout/pagamento` },
  { label: "montando o relatório", seconds: 2.9, page: "relatorio", url: `${DEMO_STORE}/checkout/pagamento` },
];

const auditStats = [
  { value: "9", label: "toques até pagar no celular", note: "média das lojas com alerta" },
  { value: "38%", label: "escondem o desconto do Pix", note: "até a última etapa" },
  { value: "1 em 4", label: "não explica o parcelamento", note: "antes do checkout" },
];

const checks = [
  { number: "01", title: "Caminho até o pagamento", text: "Quantos cliques e telas separam o produto da compra concluída." },
  { number: "02", title: "Pix, cartão e parcelamento", text: "Quando as condições aparecem e se o valor final fica claro." },
  { number: "03", title: "Experiência no celular", text: "O robô repete a compra como metade dos seus clientes faria." },
  { number: "04", title: "Sinais que geram desconfiança", text: "Nome na fatura, mensagens confusas e surpresas na última tela." },
];

/* Os cinco achados da auditoria de demonstracao, com corpo e correcao. O
   primeiro abre livre; os quatro seguintes ficam sob tarja ate o e-mail. */
const findings: Finding[] = [
  {
    severity: "alta", category: "Pagamento", at: 2, meta: "carrinho",
    title: "Quem chega no carrinho ainda não sabe se você aceita Pix",
    body: "As formas de pagamento só aparecem na quarta tela, depois que o cliente preencheu nome, CPF, endereço e escolheu o frete. Até ali ninguém sabe se dá para pagar no Pix ou em quantas vezes.",
    fix: "Colocar os selos de Pix, boleto e bandeiras dentro do carrinho, ao lado do botão de finalizar.",
  },
  {
    severity: "média", category: "Parcelamento", at: 4, meta: "pagamento",
    title: "O parcelamento aparece sem dizer o valor da parcela",
    body: "A loja mostra \u201Cem até 12x sem juros\u201D e não diz quanto é cada parcela. Quem compra parcelado faz essa conta de cabeça antes de decidir, e num produto de R$ 149 a diferença entre 12x e 6x muda a decisão.",
    fix: "Mostrar \u201C12x de R$ 12,42\u201D no produto e no carrinho, não só na tela de pagamento.",
  },
  {
    severity: "alta", category: "Pix", at: 4, meta: "pagamento",
    title: "O desconto do Pix só aparece na última tela",
    body: "A Casa Verde dá 12% no Pix, mas isso só aparece depois que o cliente já escolheu cartão. Quem já digitou o número do cartão raramente volta para trocar, e você paga a taxa de cartão numa venda que teria saído no Pix.",
    fix: "Mostrar o preço no Pix junto do preço parcelado, desde a página do produto.",
  },
  {
    severity: "alta", category: "Celular", at: 5, meta: "celular",
    title: "Quem compra pelo celular passa por três telas a mais",
    body: "No computador são quatro passos até pagar. No celular são sete, porque o endereço e o frete viram telas separadas e o teclado cobre o botão de continuar em duas delas. Metade das suas visitas vem do celular.",
    fix: "Juntar endereço e frete numa tela só e fixar o botão de continuar acima do teclado.",
  },
  {
    severity: "média", category: "Fatura", at: 6, meta: "fatura",
    title: "A fatura do seu cliente não vai dizer Casa Verde",
    body: "Na fatura aparece PAGSEG*CV3388. Trinta dias depois, o cliente não reconhece a compra e contesta. Esse é o motivo mais comum de contestação em compra legítima, e cada uma custa a venda mais a taxa.",
    fix: "Trocar o descritor no painel do gateway para CASAVERDE. Leva dez minutos e vale para todas as vendas.",
  },
];

/* A tarja e uma barra por palavra, com a largura da palavra escondida. */
function palavrasEmTarja(titulo: string): number[] {
  return titulo.split(" ").map((palavra) => Math.max(16, Math.round(palavra.length * 8.2)));
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
              <a href="#o-que-verificamos">Infraestrutura</a>
              <a href="#sobre">Quem somos</a>
              <a href="#como-funciona" className="nav-strong">Entrar</a>
            </>
          ) : (
            <button className="back-link" onClick={() => onNavigate("landing")}><ArrowLeft size={15} /> Nova análise</button>
          )}
        </nav>
        <details className="state-menu">
          <summary>Ver estados <ChevronDown size={14} /></summary>
          <div className="state-popover">
            <button onClick={() => onNavigate("running")}><Monitor size={15} /> Execução ao vivo</button>
            <button onClick={() => onNavigate("result")}><Eye size={15} /> Resultado</button>
            <button onClick={() => onNavigate("waf")}><ShieldCheck size={15} /> Loja bloqueou o robô</button>
            <button onClick={() => onNavigate("connection")}><WifiOff size={15} /> Conexão interrompida</button>
          </div>
        </details>
        <button className="mobile-menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Abrir menu">
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {menuOpen && (
        <div className="mobile-menu">
          <button onClick={() => { onNavigate("landing"); setMenuOpen(false); }}>Início</button>
          <button onClick={() => { onNavigate("running"); setMenuOpen(false); }}>Execução ao vivo</button>
          <button onClick={() => { onNavigate("result"); setMenuOpen(false); }}>Ver resultado</button>
          <button onClick={() => { onNavigate("waf"); setMenuOpen(false); }}>Estado de bloqueio</button>
        </div>
      )}
    </header>
  );
}

/* Placeholders e frases rotativas vem do desenho, com os tempos dele:
   3s para o endereco de exemplo, 2.2s para a linha do titulo. */
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

/* O campo e uma pilula ESCURA de 560x66 com o botao circular de 62px ao lado, e
   o filtro goo faz os dois se fundirem quando encostam. A seta so fica rosa
   quando ha texto: e o unico sinal de que o campo esta pronto para enviar. */
function UrlForm({ onStart, compact = false }: { onStart: (url: string) => void; compact?: boolean }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const ph = useRotacao(PLACEHOLDERS.length, 3000);

  const validate = (value: string) => {
    const cleaned = value.trim();
    if (!cleaned) return "Cole o endereço da sua loja para começar.";
    const candidate = cleaned.startsWith("http") ? cleaned : `https://${cleaned}`;
    try {
      const parsed = new URL(candidate);
      if (!parsed.hostname.includes(".")) return "Não consegui ler esse endereço. Tenta assim: minhaloja.com.br";
      return "";
    } catch {
      return "Não consegui ler esse endereço. Tenta assim: minhaloja.com.br";
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const message = validate(url);
    if (message) { setError(message); return; }
    setError("");
    setLoading(true);
    window.setTimeout(() => onStart(url), 900);
  };

  const digitando = url.trim().length > 0;

  return (
    <form className={`url-form ${compact ? "compact" : ""} ${error ? "has-error" : ""}`} onSubmit={handleSubmit} noValidate>
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
        <div className="url-input-wrap">
          <input
            type="text"
            value={url}
            onChange={(event) => { setUrl(event.target.value); if (error) setError(""); }}
            onBlur={() => { if (url) setError(validate(url)); }}
            placeholder={PLACEHOLDERS[ph]}
            aria-label="endereço da sua loja"
            aria-describedby="url-message"
            disabled={loading}
          />
        </div>
        <button
          className={`primary-button ${digitando ? "pronto" : ""}`}
          type="submit"
          disabled={loading}
          aria-label="Auditar meu checkout"
        >
          {loading ? <Spinner /> : <ArrowRight size={20} aria-hidden="true" />}
        </button>
      </div>
      <p id="url-message" className="form-message">
        {error || "Leva de 40 a 90 segundos. Sem cadastro, sem instalar nada."}
      </p>
    </form>
  );
}

/* O titulo tem uma linha fixa com brilho e uma segunda que troca a cada 2.2s.
   Sao as cinco coisas que o robo acha — a rotacao e o que diz "ha mais de um
   problema possivel" sem precisar listar. */
function HeroTitle() {
  const cur = useRotacao(ROTATIVAS.length, 2200);
  return (
    <h1 className="hero-title">
      <span className="hero-title-fixa">O robô compra na sua loja e acha</span>
      <span className="hero-title-rot">
        {ROTATIVAS.map((texto, i) => (
          <span
            key={texto}
            style={{
              opacity: i === cur ? 1 : 0,
              transform: `translateY(${i === cur ? 0 : cur > i ? -140 : 140}%)`,
            }}
          >
            {texto}
          </span>
        ))}
      </span>
    </h1>
  );
}

/* A previa ao vivo, cortada pela borda inferior do heroi.
   O campo sozinho e bonito e nao responde a desconfianca de quem ja viu
   formulario disfarcado de diagnostico. A previa prova que existe robo sem
   disputar o primeiro olhar — e o corte e o que faz rolar a pagina. */
function LivePreview() {
  return (
    <div className="live-preview" aria-hidden="true">
      <div className="live-preview-label">
        <span className="live-dot" />
        <span className="mono">acontecendo agora · auditoria de uma loja de decoração em Curitiba</span>
      </div>
      <div className="live-preview-window">
        <div className="live-preview-chrome">
          <div className="chrome-dots"><span /><span /><span /></div>
          <div className="chrome-url mono">objetodecasa.com.br/carrinho</div>
          <div className="chrome-clock mono">00:41</div>
        </div>
        <div className="live-preview-body">
          <div className="skeleton-thumb" />
          <div className="skeleton-column">
            <i style={{ width: 260 }} /><i style={{ width: 160 }} className="light" /><i style={{ width: 90, height: 20 }} />
          </div>
          <div className="skeleton-column narrow">
            <i className="light" /><i className="light" style={{ width: "70%" }} /><div className="skeleton-button" />
          </div>
          <RobotCursor className="preview-cursor" />
        </div>
      </div>
      <div className="live-preview-fade" />
    </div>
  );
}

/* O cursor do robo. A argola pulsando e o que faz o ponteiro ler como
   "alguem esta clicando agora" em vez de icone parado. */
function RobotCursor({ className }: { className?: string }) {
  return (
    <div className={`robot-cursor ${className ?? ""}`}>
      <span className="cursor-ring" />
      <svg width="17" height="21" viewBox="0 0 15 19" fill="none" aria-hidden="true">
        <path d="M1 1L1 15.5L5 12L7.5 17.5L10 16.3L7.6 11.2L12.5 10.8L1 1Z" fill="#E8386A" stroke="#fff" strokeWidth="1.1" />
      </svg>
    </div>
  );
}

function Landing({ onStart }: { onStart: (url: string) => void }) {
  return (
    <main>
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
        <LivePreview />
      </section>

      <section className="proof-section section-shell">
        <div className="section-heading split-heading">
          <div><p className="section-kicker">O que já encontramos</p><h2>Pequenos atritos.<br />Vendas que não voltam.</h2></div>
          <p>Os números abaixo vêm de checkouts que parecem funcionar. O problema aparece quando alguém tenta comprar.</p>
        </div>
        <div className="stats-grid">
          {auditStats.map((stat) => (
            <article className="stat-card" key={stat.value}>
              <strong>{stat.value}</strong>
              <h3>{stat.label}</h3>
              <p>{stat.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="o-que-verificamos" className="checks-section section-shell">
        <div className="section-heading centered-heading">
          <p className="section-kicker">Uma compra vista por inteiro</p>
          <h2>O robô não avalia sua home.<br />Ele tenta pagar.</h2>
          <p>Do primeiro produto até a última tela antes da cobrança, no computador e no celular.</p>
        </div>
        <div className="checks-grid">
          {checks.map((item, index) => (
            <article className={`check-card card-${index + 1}`} key={item.number}>
              <span className="check-number">{item.number}</span>
              <div className="check-icon">
                {index === 0 && <MousePointer2 size={23} />}
                {index === 1 && <span className="pix-glyph">◇</span>}
                {index === 2 && <Smartphone size={23} />}
                {index === 3 && <Search size={23} />}
              </div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="como-funciona" className="process-section">
        <div className="section-shell process-shell">
          <div className="process-intro">
            <p className="section-kicker light">Como funciona</p>
            <h2>Você assiste.<br />O robô trabalha.</h2>
            <p>Não pedimos faturamento, plataforma ou telefone. A análise começa pela loja, não por um formulário.</p>
            <button className="light-button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Analisar minha loja</button>
          </div>
          <div className="process-list">
            <article><span>1</span><div><h3>Você cola o endereço</h3><p>O robô identifica a plataforma e procura um produto disponível.</p></div></article>
            <article><span>2</span><div><h3>A compra acontece ao vivo</h3><p>Você acompanha cada clique no computador e no celular.</p></div></article>
            <article><span>3</span><div><h3>O relatório mostra onde agir</h3><p>Cada achado vem com evidência e uma explicação direta.</p></div></article>
          </div>
        </div>
      </section>

      <section id="sobre" className="about-section section-shell">
        <div className="about-card">
          <div className="about-mark"><span className="logo-mark large"><span /></span></div>
          <div>
            <p className="section-kicker">Feito pela Reborn</p>
            <h2>Aprovar o pagamento é só o começo.</h2>
            <p>A Reborn constrói infraestrutura de pagamento para lojas brasileiras. Criamos este raio-x porque boa parte das vendas se perde antes mesmo de o pagamento ser tentado.</p>
          </div>
          <a href="https://reborn.co" target="_blank" rel="noreferrer">Conheça a Reborn <ExternalLink size={15} /></a>
        </div>
      </section>

      <section className="final-cta">
        <div className="section-shell">
          <p className="section-kicker">Seu checkout visto como um cliente vê</p>
          <h2>Tem venda escapando.<br />Descubra por onde.</h2>
          <UrlForm onStart={onStart} compact />
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
        <div className="browser-address"><LockKeyhole size={12} /> casaverdecosmeticos.com.br/{stage === "product" ? "produtos/tenis" : stage === "checkout" ? "checkout" : "colecao"}</div>
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

/* Os achados entram na etapa em que o robo os encontra, nao todos no fim. E o
   que faz a coluna parecer medida ao vivo em vez de lista pre-carregada. */
function FindingsFeed({ progress }: { progress: number }) {
  const visiveis = findings.filter((f) => f.at <= progress);

  return (
    <div className="findings-panel">
      <div className="panel-title">
        <span>Já encontramos</span>
        <span className="mono">{visiveis.length}</span>
      </div>
      {visiveis.length === 0 ? (
        <p className="empty-finding">Nada ainda. Os primeiros achados costumam aparecer quando o robô chega no carrinho.</p>
      ) : (
        <div className="live-findings">
          {visiveis.map((f) => (
            <article className="live-finding" key={f.title}>
              <div className="finding-meta">
                <span className={`severity ${f.severity === "alta" ? "alta" : ""}`}>{f.severity}</span>
                <span>{f.category}</span>
              </div>
              <h3>{f.title}</h3>
            </article>
          ))}
        </div>
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
        <div><span className="running-pill"><Spinner /> Análise em andamento</span><div><h1>Analisando seu checkout</h1><p>{url || "casaverdecosmeticos.com.br"}</p></div></div>
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
            <div className="panel-title"><span>O que o robô está fazendo</span><span className="mono">{progress + 1} de {steps.length}</span></div>
            <div className="step-list">
              {steps.map((step, index) => {
                const status = index < progress ? "done" : index === progress ? "active" : "waiting";
                return (
                  <div className={`step-row ${status}`} key={step.label}>
                    <span className="step-status">{status === "done" ? "✓" : status === "active" ? <span className="step-dot" /> : "·"}</span>
                    <span className="step-label">{step.label}</span>
                    {status !== "waiting" && <span className="step-time mono">{step.seconds.toFixed(1)}s</span>}
                  </div>
                );
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

/* A evidencia e a captura do carrinho, com o preco real e a marcacao do que
   NAO estava la. Apontar a ausencia e mais dificil que apontar a presenca, e a
   moldura tracejada e o que torna a ausencia visivel. */
function EvidenceVisual() {
  return (
    <div className="evidence-visual">
      <p className="evidence-label mono">o que o robô viu · carrinho</p>
      <div className="evidence-frame">
        <div className="evidence-toolbar"><span className="mono">casaverdecosmeticos.com.br/carrinho</span></div>
        <div className="evidence-content">
          <div className="evidence-item">
            <div className="evidence-thumb" />
            <div><p>Sérum de vitamina C 30ml</p><p className="muted">R$ 149,00</p></div>
          </div>
          <div className="evidence-total"><span>Total</span><span>R$ 149,00</span></div>
          <div className="evidence-cta">Finalizar compra</div>
          <div className="evidence-absence">nenhuma forma de pagamento nesta tela</div>
        </div>
      </div>
      <p className="evidence-caption">Captura feita às 22h06 de 31 de agosto, no navegador desktop.</p>
    </div>
  );
}

function FindingDetail({ item, index }: { item: Finding; index: number }) {
  return (
    <article className="unlocked-finding">
      <div className="finding-index mono">0{index + 2}</div>
      <div>
        <div className="finding-meta">
          <span className={`severity ${item.severity === "alta" ? "alta" : ""}`}>{item.severity}</span>
          <span>{item.category} · achado {index + 2} de {findings.length}</span>
        </div>
        <h3>{item.title}</h3>
        <p>{item.body}</p>
        <div className="recommendation">
          <CheckCircle2 size={17} />
          <span><b>O que dá para fazer nesta semana</b>{item.fix}</span>
        </div>
      </div>
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
        <div><span className="complete-pill"><Check size={14} /> Análise concluída</span><p className="result-domain mono">auditoria de 31 de agosto, 22h06</p></div>
        <ShareButton />
      </div>

      <section className="score-card">
        <div className="score-block">
          <div className="score-gauge">
            <svg viewBox="0 0 184 184" role="img" aria-label="Nota 61 de 100">
              <circle className="gauge-track" cx="92" cy="92" r="87" />
              <circle className="gauge-value" cx="92" cy="92" r="87" />
            </svg>
            <div><strong className="mono">61</strong><span>Mediano</span></div>
          </div>
          <p className="score-caption">Nota do checkout, de 0 a 100</p>
        </div>
        <div className="score-divider" />
        <div className="score-copy">
          <h1>O checkout da Casa Verde perde gente em cinco pontos antes do pagamento. Três deles pesam.</h1>
          <p>Comparado a 340 lojas de cosméticos que já auditamos, a Casa Verde está no meio da tabela. Nenhum dos cinco achados exige trocar de plataforma.</p>
        </div>
      </section>

      <section className="report-section">
        <div className="report-title">
          <span className="severity alta grande">{findings[0].severity}</span>
          <span className="report-eyebrow">{findings[0].category} · achado 1 de {findings.length}</span>
        </div>
        <h2 className="primary-finding-title">{findings[0].title}.</h2>
        <div className="primary-finding-grid">
          <div className="finding-explanation">
            <p>{findings[0].body}</p>
            <p className="muted">Quem paga no Pix normalmente decide isso antes de digitar o CPF. Sem essa informação no carrinho, uma parte dessas pessoas fecha a aba achando que a loja só aceita cartão.</p>
            <div className="impact-box">
              <span>O que dá para fazer nesta semana</span>
              <p>{findings[0].fix} É mudança de vitrine, não de gateway.</p>
            </div>
          </div>
          <EvidenceVisual />
        </div>
      </section>

      <section className={`more-findings ${unlocked ? "is-unlocked" : "is-locked"}`}>
        <div className="more-heading"><div><h2>Faltam quatro achados</h2></div><span className="mono more-count">2 altas · 2 médias</span>{unlocked && <span className="opened-badge"><Check size={14} /> Relatório aberto</span>}</div>
        {unlocked ? (
          <div className="unlocked-list">{findings.slice(1).map((item, index) => <FindingDetail item={item} index={index} key={item.title} />)}</div>
        ) : (
          <div className="sealed-list">
            {findings.slice(1).map((item) => (
              <article className="sealed-finding" key={item.title}>
                <div className="sealed-tag">
                  <span className={`severity ${item.severity === "alta" ? "alta" : ""}`}>{item.severity}</span>
                  <span>{item.category}</span>
                </div>
                <div className={`redacted-lines ${item.severity === "média" ? "media" : ""}`}>
                  {palavrasEmTarja(item.title).map((largura, i) => (
                    <i key={`${item.title}-${i}`} style={{ width: largura }} />
                  ))}
                </div>
                <div className="sealed-meta mono">{item.meta}</div>
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
      <div className="workspace-topbar"><div><span className="info-pill">Análise interrompida</span><div><h1>{isWaf ? "A loja não deixou o robô entrar" : "Perdemos a conexão com a loja"}</h1><p>casaverdecosmeticos.com.br</p></div></div><ShareButton /></div>
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
