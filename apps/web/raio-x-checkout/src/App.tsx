import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  MoveRight,
  ChevronLeft,
  ChevronRight,
  Lock,
  Upload,
  Plus,
  Play,
  Pause,
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
import type { FormEvent, ReactNode } from "react";
import { STEP_IDS, deQuemEAculpa, paraSeveridade, temServidor, useAuditoriaAoVivo } from "./live.ts";
import type { StepId } from "./live.ts";

type Screen = "landing" | "running" | "result" | "waf" | "connection" | "gravacao";

const DEMO_STORE = "casaverde.com.br";

type Step = {
  label: string;
  /** Quanto a etapa leva. Vira o tempo ao lado do rótulo quando ela conclui. */
  seconds: number;
  /** Caminho que aparece na barra do navegador durante a etapa. */
  path: string;
};

const steps: Step[] = [
  { label: "identificando a loja", seconds: 5.2, path: "" },
  { label: "abrindo um produto", seconds: 3.8, path: "/serum-vitamina-c" },
  { label: "adicionando ao carrinho", seconds: 4.1, path: "/carrinho" },
  { label: "indo pro checkout", seconds: 6.4, path: "/checkout" },
  { label: "lendo os meios de pagamento", seconds: 8.7, path: "/checkout/pagamento" },
  { label: "repetindo no celular", seconds: 11.2, path: "/checkout/pagamento" },
  { label: "montando o relatório", seconds: 2.9, path: "/checkout/pagamento" },
];

type Finding = {
  severity: Severidade;
  category: string;
  /** Etapa em que o achado aparece, para ele entrar ao vivo e não todo no fim. */
  at: number;
  title: string;
  short: string;
  body: string;
  fix: string;
};

const findings: Finding[] = [
  {
    severity: "crítico", category: "Pagamento", at: 2,
    title: "Quem chega no carrinho ainda não sabe se você aceita Pix",
    short: "As formas de pagamento só aparecem na quarta tela.",
    body: "As formas de pagamento só aparecem na quarta tela, depois de nome, CPF, endereço e frete. Até ali ninguém sabe se dá para pagar no Pix ou em quantas vezes.",
    fix: "Colocar os selos de Pix, boleto e bandeiras dentro do carrinho, ao lado do botão de finalizar.",
  },
  {
    severity: "atenção", category: "Parcelamento", at: 4,
    title: "O parcelamento aparece sem dizer o valor da parcela",
    short: "A loja mostra \u201Cem até 12x\u201D e não diz quanto é cada uma.",
    body: "A loja mostra \u201Cem até 12x sem juros\u201D e não diz quanto é cada parcela. Quem compra parcelado faz essa conta de cabeça antes de decidir, e num produto de R$ 149 a diferença entre 12x e 6x muda a decisão.",
    fix: "Mostrar \u201C12x de R$ 12,42\u201D no produto e no carrinho, não só na tela de pagamento.",
  },
  {
    severity: "crítico", category: "Pix", at: 4,
    title: "O desconto do Pix só aparece na última tela",
    short: "O cliente escolhe cartão antes de saber que pagaria menos no Pix.",
    body: "A loja dá 12% no Pix, mas isso só aparece depois que o cliente já escolheu cartão. Quem digitou o número do cartão raramente volta para trocar, e você paga a taxa de cartão numa venda que teria saído no Pix.",
    fix: "Mostrar o preço no Pix junto do preço parcelado, desde a página do produto.",
  },
  {
    severity: "crítico", category: "Celular", at: 5,
    title: "Quem compra pelo celular passa por três telas a mais",
    short: "Quatro passos no computador, sete no celular.",
    body: "No computador são quatro passos até pagar. No celular são sete, porque endereço e frete viram telas separadas e o teclado cobre o botão de continuar em duas delas. Metade das suas visitas vem do celular.",
    fix: "Juntar endereço e frete numa tela só e fixar o botão de continuar acima do teclado.",
  },
  {
    severity: "atenção", category: "Fatura", at: 6,
    title: "A fatura do seu cliente não vai dizer o nome da sua loja",
    short: "Vai aparecer um código do gateway, não a sua marca.",
    body: "Na fatura aparece o descritor do gateway, não o nome da loja. Trinta dias depois o cliente não reconhece a compra e contesta. Esse é o motivo mais comum de contestação em compra legítima, e cada uma custa a venda mais a taxa.",
    fix: "Trocar o descritor no painel do gateway para o nome da loja. Leva dez minutos e vale para todas as vendas.",
  },
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
  const semProtocolo = limpo.replace(/^https?:\/\//, "");
  /* Endereço local só vale em desenvolvimento, e é o que permite testar contra
     a loja falsa do `npm run live:fake`. Em produção continua recusado: IP não
     é loja, e o motor recusa igual, com IP_LITERAL. */
  const localOk = mostrarEstados() && /^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(semProtocolo);
  const valido = localOk || /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(semProtocolo);
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

/* A execução em números, do desenho: o relógio corre acelerado (escala .62) e
   os três estados de imagem caem em janelas fixas de segundos reais. */
const ESCALA = 0.62;
const CURSORES: [number, number][] = [[46, 30], [30, 62], [72, 74], [64, 86], [38, 52], [82, 40], [50, 50]];

function useCronometro(rodando: boolean) {
  const [seg, setSeg] = useState(0);
  useEffect(() => {
    if (!rodando) return;
    const inicio = Date.now();
    const t = window.setInterval(() => setSeg((Date.now() - inicio) / 1000), 100);
    return () => window.clearInterval(t);
  }, [rodando]);
  return seg;
}

/* O relógio da demonstração corre acelerado porque a jornada inteira dela cabe
   em poucos segundos. Com o motor ligado ele conta segundo de verdade: dividir
   por .62 mostrava 03:13 numa auditoria de 2 minutos, e um relógio que corre
   1,6x mais rápido que o mundo faz o orçamento de 120s parecer estourado
   quando ele não estourou. */
function relogio(segundos: number, acelerado: boolean): string {
  const t = acelerado ? segundos / ESCALA : segundos;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}

/* A moldura do navegador. A pílula do endereço encolhe com flex e trunca a URL
   com reticências em vez de empurrar os ícones para fora. */
function Navegador({ url, frozen, children, rodape }: { url: string; frozen: boolean; children: ReactNode; rodape: ReactNode }) {
  return (
    <div className="navegador">
      <div className="navegador-barra">
        {frozen && <span className="navegador-fio" aria-hidden="true" />}
        <div className="navegador-esq">
          <div className="navegador-bolas"><i /><i /><i /></div>
          <span className="navegador-setas">
            <ChevronLeft size={13} aria-hidden="true" />
            <ChevronRight size={13} aria-hidden="true" />
          </span>
        </div>
        <div className="navegador-url mono">
          <Lock size={11} aria-hidden="true" />
          <span>{url}</span>
        </div>
        <div className="navegador-dir">
          <Upload size={13} aria-hidden="true" />
          <Plus size={13} aria-hidden="true" />
        </div>
      </div>
      <div className="navegador-tela">{children}</div>
      <div className="navegador-rodape">{rodape}</div>
    </div>
  );
}

/* O esqueleto do primeiro frame. A grade tem geometria de vitrine porque é o
   que o robô está carregando naquele momento — e o aviso embaixo diz que
   aquilo não é a loja da pessoa. Um esqueleto realista demais viraria mentira. */
function EsperandoPrimeiroFrame() {
  return (
    <div className="espera">
      <div className="espera-grade" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <div className="espera-card" key={k}>
            <div className="espera-img" />
            <div className="espera-linha larga" />
            <div className="espera-linha curta" />
          </div>
        ))}
      </div>
      <div className="espera-lupa" aria-hidden="true">
        <div className="espera-halo"><Search size={19} /></div>
      </div>
      <div className="espera-aviso">
        <span className="ponto-vivo" />
        <span>O robô já está na sua loja. A primeira imagem chega em alguns segundos.</span>
      </div>
    </div>
  );
}

/* `duracoes` chega vazio na demonstração, e aí cada etapa mostra o tempo do
   desenho. Com o motor ligado é o tempo que a etapa levou de verdade: mostrar
   "4.1s" numa etapa que levou 90 segundos escondia exatamente o lugar onde a
   pessoa precisava olhar. */
function PainelEtapas({ stage, parou, duracoes }: { stage: number; parou?: boolean; duracoes?: Partial<Record<StepId, number>> }) {
  return (
    <div className="painel">
      <div className="painel-topo">
        <span>Etapas da análise</span>
        <span className="mono painel-conta">{Math.min(stage + 1, steps.length)} de {steps.length}</span>
      </div>
      <div className="painel-barra">
        <div className="barra-trilho">
          <div className="barra-indicador" style={{ transform: `translateX(-${100 - (100 * Math.min(stage + 1, steps.length)) / steps.length}%)` }} />
        </div>
      </div>
      <div className="painel-etapas">
        {steps.map((s, i) => {
          const feito = i < stage;
          const agora = i === stage;
          return (
            <div className="etapa" key={s.label}>
              <div className="etapa-marca">
                <div className={`etapa-ponto ${feito ? "feito" : agora && !parou ? "agora" : "fila"}`}>
                  {feito ? <Check size={13} strokeWidth={3} /> : agora && !parou ? <span className="etapa-anel" /> : <span className="mono">{i + 1}</span>}
                </div>
                {i < steps.length - 1 && <div className={`etapa-traco ${feito ? "feito" : ""}`} />}
              </div>
              <div className={`etapa-texto ${feito || agora ? "" : "fila"}`}>
                <h3>{s.label}</h3>
                <span className="mono">{feito ? `${(duracoes?.[STEP_IDS[i] as StepId] ?? s.seconds).toFixed(1)}s` : ""}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PainelAchados({ stage, doMotor }: { stage: number; doMotor?: { code: string; severity: string; title: string }[] }) {
  const visiveis = doMotor?.length
    ? doMotor.map((a) => ({
        title: a.title,
        short: "",
        severity: paraSeveridade(a.severity as "critica" | "alta" | "media" | "baixa"),
        category: "",
      }))
    : temServidor()
      ? []
      : findings.filter((f) => f.at <= stage);
  return (
    <div className="painel">
      <div className="painel-topo">
        <span>Já encontramos</span>
        <span className="mono painel-conta">{visiveis.length}</span>
      </div>
      {visiveis.length === 0 ? (
        <p className="painel-vazio">Nada ainda. Os primeiros achados costumam aparecer quando o robô chega no carrinho.</p>
      ) : (
        visiveis.map((f) => (
          <article className="achado-vivo" key={f.title}>
            <Severidade sev={f.severity} />
            <h4>{f.title}</h4>
            {f.short && <p>{f.short}</p>}
          </article>
        ))
      )}
    </div>
  );
}

function Running({ onComplete, url, onAbortado, nossoProblema }: { onComplete: (nota: number | null, ressalva: string | null, gravacao: { data: string; t: number }[]) => void; url: string; onAbortado: (code: string, reason: string, ate: Apurado) => void; nossoProblema: string | null }) {
  const vivo = useAuditoriaAoVivo(temServidor() ? url : null);
  const simulado = useCronometro(!temServidor());
  /* Parou de rodar: por recusa do motor, ou porque nao alcancamos o servidor.
     Nos dois casos nada esta acontecendo, e a tela precisa parar de encenar. */
  const parou = Boolean(nossoProblema) || Boolean(vivo.falhaNossa);
  /* "Não começou" e "parou no meio" são coisas diferentes, e dizer a primeira
     quando foi a segunda é inventar resultado. Um prazo estourado aos 2
     minutos tinha etapa andada e imagem na tela: aquilo começou. */
  const comecou = vivo.stage > 0 || vivo.frame !== null;
  const [congelado, setCongelado] = useState<number | null>(null);
  useEffect(() => {
    if (parou) setCongelado((c) => c ?? (temServidor() ? vivo.segundos : simulado));
  }, [parou, vivo.segundos, simulado]);
  const e = congelado ?? (temServidor() ? vivo.segundos : simulado);
  const host = url || DEMO_STORE;

  /* Três estados de imagem. Na demonstração eles caem em janelas fixas de
     relógio, que é como o desenho os mostra. Com o motor ligado, janela fixa
     seria encenação: a faixa "você ficou 16 segundos sem imagem" apareceria
     aos 22s de toda auditoria, tendo ou não havido queda. Aqui eles saem do
     que de fato aconteceu — e a faixa de reconexão, que traz números fixos no
     texto, simplesmente não aparece ao vivo. */
  const esperando = temServidor() ? vivo.frame === null : e < 3.4;
  /* `!parou` porque uma auditoria que acabou nao tem "leitura seguindo": a
     tela dizia no meio que a auditoria parou e embaixo que o robo estava
     adicionando ao carrinho agora, ao mesmo tempo. */
  const travado = temServidor() ? !parou && vivo.frame !== null && vivo.semImagem > 4 : e > 13.5 && e < 19.5;
  const reconectado = temServidor() ? false : e > 22 && e < 29;

  /* Com servidor, a etapa vem do evento; sem ele, do relógio da demonstração.
     Os dois alimentam o mesmo `stage`, então a tela é uma só. */
  let stage = vivo.stage;
  if (!temServidor()) {
    let acc = 0;
    stage = 0;
    for (let i = 0; i < steps.length; i++) {
      acc += (steps[i] as (typeof steps)[number]).seconds * ESCALA;
      if (e > acc) stage = i + 1;
    }
  }

  useEffect(() => {
    if (stage >= steps.length) onComplete(vivo.fim?.score ?? null, vivo.fim?.caveat ?? null, vivo.gravacao);
  }, [stage, onComplete, vivo.fim, vivo.gravacao]);

  /* Só evento do motor muda de tela. Falha nossa fica aqui, dita na linha de
     estado: mandar o usuário para "a loja caiu" seria culpar a loja pelo que
     quebrou do nosso lado. */
  /* Leva junto o que já tinha sido apurado. A tela de exceção mostra isso, e
     sem passar por aqui ela não teria de onde tirar — o estado ao vivo morre
     com esta tela. */
  useEffect(() => {
    if (!vivo.abortado) return;
    onAbortado(vivo.abortado.code, vivo.abortado.reason, {
      stage: vivo.stage,
      duracoes: vivo.duracoes,
      achados: vivo.achados.length,
      motivo: vivo.abortado.reason,
    });
  }, [vivo.abortado, vivo.stage, vivo.duracoes, vivo.achados, onAbortado]);

  const passo = steps[Math.min(stage, steps.length - 1)]!;
  const cursor = CURSORES[Math.min(stage, CURSORES.length - 1)]!;

  return (
    <main className="exec-page">
      <div className="exec-shell">
        <div className="exec-topo">
          <div className="exec-titulo">
            <span className={`pill-andamento ${parou ? "parada" : ""}`}>
              {parou ? <X size={15} aria-hidden="true" /> : <LoaderCircle className="gira" size={15} aria-hidden="true" />}
              {parou ? (comecou ? "Análise interrompida" : "Análise não começou") : "Análise em andamento"}
            </span>
            <div>
              <h1 className="texto-brilho">Analisando seu checkout</h1>
              <p className="mono exec-host">{host}</p>
            </div>
          </div>
          <div className="exec-acoes">
            <span className="mono exec-relogio">{relogio(e, !temServidor())}</span>
            <ShareButton />
          </div>
        </div>

        <div className="exec-grid">
          <section className="exec-live">
            {reconectado && (
              <div className="reconexao">
                <div className="reconexao-copy">
                  <span className="reconexao-titulo">Voltamos. Você ficou 16 segundos sem imagem.</span>
                  <span>Enquanto estávamos fora o robô continuou e encontrou mais um problema. Recuperamos os passos e o achado. As imagens desse intervalo não voltam.</span>
                </div>
                <div className="reconexao-faixa">
                  <span className="mono">00:22</span>
                  <span className="reconexao-hachura" aria-hidden="true" />
                  <span className="mono">00:38</span>
                </div>
              </div>
            )}

            <Navegador
              /* Ao vivo, o endereço que o robô está vendo. Na demonstração, o
                 caminho do desenho — que só é honesto porque ali a loja também
                 é fictícia. Somar o domínio real da loja com o caminho do
                 desenho, como estava, produzia endereço inventado. */
              url={temServidor() ? (vivo.urlAtual ?? host) : `${host}${passo.path}`}
              frozen={travado}
              rodape={
                <>
                  <span className="rodape-estado">
                    <span className="rodape-ponto" style={{ background: nossoProblema || vivo.falhaNossa || travado ? "#99979c" : "var(--accent)" }} />
                    {nossoProblema
                      ? `a auditoria parou do nosso lado · ${nossoProblema}`
                      : vivo.falhaNossa
                      ? "não conseguimos falar com o nosso servidor · a loja não tem nada a ver com isso"
                      : esperando ? "conectado · aguardando primeira imagem" : travado ? "imagem parada · execução seguindo" : "transmissão ao vivo"}
                  </span>
                  <span className="mono">1280 × 720</span>
                </>
              }
            >
              {parou ? (
                <div className="parou-aviso">
                  <X size={22} aria-hidden="true" />
                  <span className="parou-titulo">
                    {nossoProblema
                      ? comecou
                        ? "A auditoria parou no meio"
                        : "A auditoria não começou"
                      : "Não conseguimos falar com o nosso servidor"}
                  </span>
                  <span className="parou-motivo">
                    {nossoProblema ?? "O motor não respondeu. A loja não tem nada a ver com isso."}
                  </span>
                  <span className="parou-nota">Isso é limitação nossa, não da loja.</span>
                </div>
              ) : esperando ? (
                <EsperandoPrimeiroFrame />
              ) : (
                <>
                  {vivo.frame ? (
                    <img className="frame-vivo" src={vivo.frame} alt="transmissão da loja auditada" />
                  ) : (
                    <div className="slot-screencast">
                      <div className="slot-moldura" />
                      <span className="mono">frame do screencast · 1280 × 720</span>
                    </div>
                  )}
                  <div className="cursor-robo" style={{ left: `${cursor[0]}%`, top: `${cursor[1]}%` }} aria-hidden="true">
                    <span className="cursor-anel" />
                    <svg width="17" height="21" viewBox="0 0 15 19" fill="none">
                      <path d="M1 1L1 15.5L5 12L7.5 17.5L10 16.3L7.6 11.2L12.5 10.8L1 1Z" fill="#E8386A" stroke="#fff" strokeWidth="1.1" />
                    </svg>
                  </div>
                </>
              )}

              {travado && (
                <>
                  <div className="travado-chip">
                    <span className="travado-ponto" />
                    {/* 13.5 é o começo da janela da demonstração; ao vivo,
                        quem conta é o tempo real desde o último frame. */}
                    <span>Imagem parada há {Math.round(temServidor() ? vivo.semImagem : e - 13.5)}s</span>
                  </div>
                  <div className="travado-aviso">
                    <span className="ponto-vivo" />
                    <span>A imagem parou, a leitura não. O robô está {passo.label} agora.</span>
                  </div>
                </>
              )}
            </Navegador>

            <p className="exec-nota">O robô está navegando como um cliente comum. Frame perdido é frame perdido.</p>
          </section>

          <aside className="exec-side">
            <PainelEtapas stage={stage} parou={parou} duracoes={vivo.duracoes} />
            <PainelAchados stage={stage} doMotor={vivo.achados} />
          </aside>
        </div>
      </div>
    </main>
  );
}

/* A evidência é a captura do carrinho com o preço real e a marcação do que
   NÃO estava lá. Apontar ausência é mais difícil que apontar presença, e a
   moldura tracejada é o que torna a ausência visível. */
function Evidencia({ host }: { host: string }) {
  return (
    <div className="evidencia">
      <span className="mono evidencia-rotulo">o que o robô viu · carrinho</span>
      <div className="evidencia-quadro">
        <div className="mono evidencia-url">{host}/carrinho</div>
        <div className="evidencia-corpo">
          <div className="evidencia-item">
            <div className="evidencia-foto" />
            <div>
              <span>Sérum de vitamina C 30ml</span>
              <span className="fraco">R$ 149,00</span>
            </div>
          </div>
          <div className="evidencia-total"><span>Total</span><span>R$ 149,00</span></div>
          <div className="evidencia-botao">Finalizar compra</div>
          <div className="evidencia-ausencia">nenhuma forma de pagamento nesta tela</div>
        </div>
      </div>
      <span className="evidencia-legenda">Captura feita durante a auditoria, no navegador desktop.</span>
    </div>
  );
}

/* A cobertura é tarja, não desfoque: uma barra por palavra, com a largura da
   palavra que ela esconde. O desfoque diria "escondi algo"; a tarja diz "o
   texto está aqui, medido, e você não leu". Severidade e categoria ficam
   legíveis de propósito, para dar para contar os achados e ver o peso deles
   antes de decidir se vale entregar os dados. */
function Tarja({ f }: { f: Finding }) {
  return (
    <div className="tarja-linha">
      <div className="tarja-tag">
        <Severidade sev={f.severity} />
        <span>{f.category}</span>
      </div>
      <div className="tarja-palavras" aria-label={`Achado coberto: ${f.category}`}>
        {f.title.split(" ").map((palavra, i) => (
          <span
            key={`${f.title}-${i}`}
            className={f.severity === "crítico" ? "" : "clara"}
            style={{ width: Math.max(16, Math.round(palavra.length * 8.2)) }}
          />
        ))}
      </div>
    </div>
  );
}

/* Um campo por vez, com a seta aparecendo só quando o campo fica válido e o
   caminho de volta sempre visível. Quatro passos em vez de um formulário
   inteiro: cada um pede uma coisa e diz para que serve. */
type CampoCaptura = {
  chave: string;
  titulo: string;
  sub: string;
  placeholder?: string;
  escolha?: boolean;
};

const CAMPOS: CampoCaptura[] = [
  { chave: "nome", titulo: "Antes de abrir, como a gente te chama?", sub: "O relatório vem com o seu nome e o endereço da loja no topo, para você mandar para quem cuida do site.", placeholder: "seu nome" },
  { chave: "zap", titulo: "Qual o seu WhatsApp?", sub: "Só usamos se você pedir. O relatório completo vai por e-mail.", placeholder: "(11) 90000-0000" },
  { chave: "email", titulo: "Para onde mandamos o relatório?", sub: "Um e-mail, uma vez, com os cinco achados por extenso, as capturas e o que fazer em cada caso. Sem sequência depois, sem ligação de vendedor.", placeholder: "seu e-mail" },
  { chave: "faixa", titulo: "Quanto a loja fatura por mês?", sub: "Serve para comparar a sua nota com lojas do mesmo porte. Fica entre a gente.", escolha: true },
];

const FAIXAS = ["até R$ 100 mil", "R$ 100 mil a R$ 500 mil", "R$ 500 mil a R$ 2 mi", "acima de R$ 2 mi"];

function valida(chave: string, v: string): boolean {
  const t = (v || "").trim();
  if (chave === "nome") return t.length >= 2;
  if (chave === "zap") return t.replace(/\D/g, "").length >= 10;
  if (chave === "email") return /.+@.+\..+/.test(t);
  return false;
}

function Captura({ onAbrir }: { onAbrir: (email: string) => void }) {
  const [passo, setPasso] = useState(0);
  const [valores, setValores] = useState<Record<string, string>>({});
  const campo = CAMPOS[passo]!;
  const valor = valores[campo.chave] ?? "";
  const ok = valida(campo.chave, valor);

  const avancar = () => {
    if (!ok) return;
    setPasso((p) => p + 1);
  };

  return (
    <div className="captura">
      <div className="captura-copy">
        <span className="captura-titulo">{campo.titulo}</span>
        <span className="captura-sub">{campo.sub}</span>
      </div>
      <div className="captura-campo">
        {campo.escolha ? (
          <div className="captura-faixas">
            {FAIXAS.map((f) => (
              <button type="button" key={f} onClick={() => onAbrir(valores["email"] ?? "seu e-mail")}>{f}</button>
            ))}
          </div>
        ) : (
          <div className="captura-pill">
            <input
              type="text"
              aria-label={campo.placeholder}
              placeholder={campo.placeholder}
              value={valor}
              onChange={(e) => setValores((v) => ({ ...v, [campo.chave]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") avancar(); }}
            />
            {ok && (
              <button type="button" aria-label="Continuar" onClick={avancar}>
                <MoveRight size={19} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        <div className="captura-rodape">
          {passo > 0 && (
            <button type="button" className="captura-voltar" onClick={() => setPasso((p) => Math.max(0, p - 1))}>
              <ArrowLeft size={15} aria-hidden="true" /> Voltar
            </button>
          )}
          <div className="captura-pontos">
            {[0, 1, 2, 3].map((i) => <span key={i} className={i <= passo ? "aceso" : ""} />)}
            <span className="mono">{passo + 1} de 4</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* O anel conta de zero até a nota quando entra na tela. O valor final fica na
   marcação: se a animação não rodar, a nota certa continua lá em vez de
   aparecer zero. */
/* `nota` nula é auditoria que mediu pouco demais para pontuar. O anel fica
   vazio e o número não aparece — porque o campo vazio é a verdade, e qualquer
   número ali seria inventado. */
function Anel({ nota }: { nota: number | null }) {
  const [mostrado, setMostrado] = useState(nota ?? 0);
  const ref = useRef<SVGCircleElement | null>(null);
  const C = 2 * Math.PI * 86;

  useEffect(() => {
    if (nota === null) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const anel = ref.current;
    if (!anel) return;
    setMostrado(0);
    const alvo = C - (C * nota) / 100;
    anel.animate([{ strokeDashoffset: C }, { strokeDashoffset: alvo }], {
      duration: 1600, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both",
    });
    let inicio: number | null = null;
    const passo = (t: number) => {
      if (inicio === null) inicio = t;
      const p = Math.min(1, (t - inicio) / 1600);
      setMostrado(Math.round(nota * (1 - (1 - p) ** 3)));
      if (p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }, [nota, C]);

  return (
    <div className="anel">
      <svg viewBox="0 0 184 184" role="img" aria-label={nota === null ? "Sem nota: a auditoria mediu pouco" : `Nota ${nota} de 100`}>
        <circle className="anel-trilho" cx="92" cy="92" r="86" />
        <circle ref={ref} className="anel-valor" cx="92" cy="92" r="86" strokeDasharray={C} strokeDashoffset={nota === null ? C : C - (C * nota) / 100} />
      </svg>
      <div className="anel-centro">
        <span className="mono anel-nota">{nota === null ? "—" : mostrado}</span>
        <span className="anel-veredito">{nota === null ? "sem nota" : "Mediano"}</span>
      </div>
    </div>
  );
}

function Result({ onRestart, onGravacao, url, nota, ressalva }: { onRestart: () => void; onGravacao: () => void; url: string; nota: number | null; ressalva: string | null }) {
  const [aberto, setAberto] = useState(false);
  const [email, setEmail] = useState("seu e-mail");
  const host = url || DEMO_STORE;
  const primeiro = findings[0]!;

  return (
    <main className="resultado">
      <div className="resultado-shell">
        <div className="resultado-topo">
          <span className="mono">{host} · auditoria de 1 de setembro</span>
          <ShareButton />
        </div>

        <section className="nota-card">
          <div className="nota-bloco">
            <Anel nota={nota} />
            <span className="nota-legenda">Nota do checkout, de 0 a 100</span>
            {/* A ressalva de cobertura viaja junto com o número: ele nunca
                chega sozinho. Quando a auditoria mediu pouco, dizer só a nota
                seria promessa falsa. */}
            {ressalva && <span className="nota-ressalva">{ressalva}</span>}
          </div>
          <div className="nota-copy">
            <h1>Seu checkout perde gente em cinco pontos antes do pagamento. Três deles pesam.</h1>
            <p>Comparado a 340 lojas do mesmo porte, você está no meio da tabela. Nenhum dos cinco achados exige trocar de plataforma.</p>
          </div>
        </section>

        <section className="achado-aberto">
          <div className="achado-meta">
            <Severidade sev={primeiro.severity} />
            <span>{primeiro.category} · achado 1 de {findings.length}</span>
          </div>
          <h2>{primeiro.title}.</h2>
          <div className="achado-grid">
            <div className="achado-texto">
              <p>As formas de pagamento só aparecem na quarta tela, depois que o cliente já preencheu nome, CPF, endereço e escolheu o frete. Até ali, ninguém sabe se dá para pagar no Pix, em quantas vezes, ou se o cartão dele é aceito.</p>
              <p className="fraco">Quem paga no Pix normalmente decide isso antes de digitar o CPF. Sem essa informação no carrinho, uma parte dessas pessoas fecha a aba achando que a loja só aceita cartão.</p>
              <div className="achado-fazer">
                <span className="achado-fazer-titulo">O que dá para fazer nesta semana</span>
                <span>{primeiro.fix} É mudança de vitrine, não de gateway.</span>
              </div>
            </div>
            <Evidencia host={host} />
          </div>
        </section>

        {aberto ? (
          <section className="abertos">
            <div className="abertos-aviso">
              <span className="abertos-ponto" />
              <span>Mandamos o relatório completo para {email}. Chega em um minuto.</span>
            </div>
            {findings.slice(1).map((f) => (
              <article className="achado-aberto" key={f.title}>
                <div className="achado-meta">
                  <Severidade sev={f.severity} />
                  <span>{f.category}</span>
                </div>
                <h3>{f.title}</h3>
                <p className="fraco">{f.body}</p>
                <div className="achado-fix">{f.fix}</div>
              </article>
            ))}
          </section>
        ) : (
          <section className="cobertos">
            <div className="cobertos-topo">
              <span>Faltam quatro achados</span>
              <span className="mono">2 críticos · 2 de atenção</span>
            </div>
            {findings.slice(1).map((f) => <Tarja f={f} key={f.title} />)}
            <Captura onAbrir={(e) => { setEmail(e); setAberto(true); }} />
          </section>
        )}

        <div className="resultado-rodape">
          <span>A auditoria não altera nada na sua loja. Só olha.</span>
          <button type="button" className="botao-fino" onClick={onGravacao}>Ver a gravação</button>
          <button type="button" className="botao-fino" onClick={onRestart}>Auditar outra loja</button>
        </div>
      </div>
    </main>
  );
}

/* As duas telas ruins. O LEIA-ME e explicito: elas nao podem parecer erro de
   sistema. Sao informacao sobre a loja e sao tratadas como conteudo — por isso
   o rotulo "achado, nao erro" e por isso o achado que ja existe continua
   valendo mesmo quando a auditoria parou. */
/* A gravação: quem recebe o link pelo WhatsApp não assistiu ao vivo, e para
   essa pessoa a auditoria precisa ser um vídeo que ela dá play.
   
   Os frames vivem só na aba de quem assistiu — nada vai para disco. Quem abre
   o link sem ter visto a execução não tem gravação, e a tela diz isso em vez
   de mostrar um player que não toca. */
function Gravacao({ host, frames, onVoltar }: { host: string; frames: { data: string; t: number }[]; onVoltar: () => void }) {
  const [tocando, setTocando] = useState(false);
  const [i, setI] = useState(0);
  const tem = frames.length > 0;
  const duracao = tem ? (frames[frames.length - 1]?.t ?? 0) : 0;

  useEffect(() => {
    if (!tocando || !tem) return;
    const t = window.setInterval(() => {
      setI((n) => {
        if (n + 1 >= frames.length) { setTocando(false); return n; }
        return n + 1;
      });
    }, 125);
    return () => window.clearInterval(t);
  }, [tocando, tem, frames.length]);

  const agora = frames[i]?.t ?? 0;
  const cronometro = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  /* Os sete passos viram marcas e os cinco achados viram alfinetes. É o que faz
     o vídeo virar índice em vez de reprodução: cada alfinete leva ao segundo em
     que o robô encontrou aquele problema. */
  const marcas = [8, 20, 33, 48, 66, 88];
  const alfinetes = [33, 52, 61, 74, 91];

  const irPara = (pct: number) => {
    if (!tem) return;
    const alvo = (pct / 100) * duracao;
    const idx = frames.findIndex((f) => f.t >= alvo);
    setI(idx < 0 ? frames.length - 1 : idx);
  };

  return (
    <main className="gravacao">
      <div className="gravacao-shell">
        <div className="gravacao-topo">
          <span className="mono">{host} · gravação da auditoria</span>
          <button type="button" className="botao-fino" onClick={onVoltar}>Voltar ao resultado</button>
        </div>

        <div className="player">
          <div className="player-tela">
            {tem ? (
              <img src={frames[i]?.data} alt={`Gravação da auditoria, segundo ${Math.floor(agora)}`} />
            ) : (
              <div className="player-vazio">
                <div className="player-moldura" />
                <span className="mono">gravação do screencast · 1280 × 720</span>
                <span className="player-aviso">A gravação fica só no navegador de quem assistiu. Rode a auditoria de novo para ver esta tela com imagem.</span>
              </div>
            )}
            {tem && !tocando && (
              <button type="button" className="player-play-grande" onClick={() => setTocando(true)} aria-label="Reproduzir">
                <Play size={30} fill="currentColor" aria-hidden="true" />
              </button>
            )}
            <div className="player-host"><span className="player-host-ponto" />{host}</div>
            <div className="player-estado">{tocando ? "Reproduzindo" : "Pausado"}</div>
          </div>

          <div className="player-controles">
            <div className="linha-do-tempo">
              <div className="linha-trilho" />
              {marcas.map((m) => <div className="linha-marca" style={{ left: `${m}%` }} key={m} />)}
              {alfinetes.map((a, n) => (
                <button
                  type="button"
                  className="linha-alfinete"
                  style={{ left: `${a}%` }}
                  key={a}
                  onClick={() => irPara(a)}
                  aria-label={`Pular para o achado ${n + 1}: ${findings[n]?.title ?? ""}`}
                />
              ))}
            </div>
            <div className="player-barra">
              <div className="player-esq">
                <button type="button" className="player-play" onClick={() => setTocando((t) => !t)} aria-label={tocando ? "Pausar" : "Reproduzir"}>
                  {tocando ? <Pause size={16} fill="currentColor" aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />}
                </button>
                <span className="mono">{cronometro(agora)} / {cronometro(duracao)}</span>
                <span className="player-divisor" />
                <span>5 achados marcados em rosa</span>
              </div>
              <ShareButton />
            </div>
          </div>
        </div>
        <p className="gravacao-nota">Clicar num alfinete rosa pula para o segundo em que o robô encontrou aquele problema.</p>
      </div>
    </main>
  );
}

/* `real` chega quando a auditoria de verdade parou aqui; fica ausente na
   demonstração, e aí a tela é a do desenho.

   Isto existe porque a tela estava contando uma história. Uma auditoria que
   morreu na terceira etapa, sem nenhum achado, abria esta tela dizendo "5 de 7
   concluídos", listando "lendo os meios de pagamento 8.7s" com um ✓, e
   fechando com "Três achados guardados". Nada daquilo aconteceu. Os números
   eram os do desenho, que a tela mostrava sempre. */
/** O que a auditoria de verdade tinha apurado quando parou. */
type Apurado = { stage: number; duracoes: Partial<Record<StepId, number>>; achados: number; motivo: string | null };

function ExceptionState({
  type,
  onRetry,
  onRestart,
  real,
}: {
  type: "waf" | "connection";
  onRetry: () => void;
  onRestart: () => void;
  real?: Apurado;
}) {
  const bloqueio = type === "waf";
  const feitas = real ? real.stage : bloqueio ? 3 : 5;

  return (
    <main className="erro-page">
      <div className="erro-shell">
        <section className="erro-card">
          {!bloqueio && (
            <div className="erro-fio" aria-hidden="true"><span /></div>
          )}
          <div className="erro-marca">
            {bloqueio ? (
              <>
                <ShieldCheck size={15} aria-hidden="true" />
                <span className="mono">achado, não erro</span>
              </>
            ) : real ? (
              /* Não existe repetição automática e não existe e-mail. Anunciar
                 "tentativa 2 de 5" era prometer um mecanismo que o motor não
                 tem. O que existe é o motivo que o motor deu. */
              <span className="mono">{real.motivo ?? "a loja parou de responder"}</span>
            ) : (
              <span className="mono">reconectando · tentativa 2 de 5</span>
            )}
          </div>
          <h1>
            {bloqueio
              ? "Sua loja bloqueou nosso robô na terceira página."
              : "Perdemos a conexão com a loja no meio do checkout."}
          </h1>
          <p className="fraco">
            {bloqueio
              ? "O sistema antifraude entendeu que a navegação era suspeita e cortou a sessão. Isso protege a loja, e também acontece com gente de verdade: cliente em rede corporativa, em VPN, ou que navega rápido demais."
              : real
              ? "O que o robô já tinha apurado está guardado. Para tentar de novo, é você que decide quando."
              : "Estamos voltando de onde paramos. Nada do que já foi encontrado se perde. Se a loja não responder em cinco tentativas, mandamos por e-mail o que deu para apurar."}
          </p>
          <p>
            {bloqueio
              ? "Vale olhar quantas sessões legítimas você está perdendo por dia nessa mesma regra."
              : "Se isso acontece com a gente às oito da noite, também acontece com quem está pagando."}
          </p>
          <div className="erro-acoes">
            <button type="button" className="pill-button" onClick={bloqueio ? onRestart : onRetry}>
              <span>{bloqueio ? "Falar com alguém da Reborn" : "Ver o que já temos"}</span>
              <span className="button-icon"><ArrowUpRight size={14} aria-hidden="true" /></span>
            </button>
            <button type="button" className="botao-fino" onClick={onRestart}>
              {bloqueio ? "Tentar outro endereço" : "Cancelar"}
            </button>
          </div>
        </section>

        <aside className="erro-lado">
          <span className="mono erro-lado-titulo">
            {bloqueio && !real ? "o que deu tempo de ver" : `${feitas} de ${steps.length} concluídos`}
          </span>
          <div className="mono erro-etapas">
            {steps.slice(0, bloqueio && !real ? 4 : 7).map((s, i) => {
              const ok = i < feitas;
              const parada = i === feitas;
              const medido = real?.duracoes[STEP_IDS[i] as StepId];
              const segundos = real ? medido : s.seconds;
              return (
                <span className={ok ? "" : parada ? "parada" : bloqueio ? "cortada" : "fila"} key={s.label}>
                  {ok ? "✓" : parada ? "⏸" : bloqueio ? "✕" : "·"} {s.label}{" "}
                  {ok && segundos !== undefined ? `${segundos.toFixed(1)}s` : ""}
                </span>
              );
            })}
          </div>
          {bloqueio && !real ? (
            <div className="erro-achado">
              <Severidade sev={findings[0]!.severity} />
              <span className="erro-achado-titulo">{findings[0]!.title}</span>
              <span className="fraco">Esse achado é seu de qualquer forma. O link continua valendo.</span>
            </div>
          ) : real ? (
            <span className="fraco erro-nota">
              {real.achados === 0
                ? "Nenhum achado até aqui. Não dá para tirar conclusão de uma jornada que parou no meio."
                : real.achados === 1
                ? "Um achado guardado."
                : `${real.achados} achados guardados.`}
            </span>
          ) : (
            <span className="fraco erro-nota">Três achados guardados. Você não perde nada esperando.</span>
          )}
        </aside>
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
  /* A nota vem do motor quando ele responde. Sem servidor, a do desenho. */
  const [resultado, setResultado] = useState<{ nota: number | null; ressalva: string | null }>({ nota: 61, ressalva: null });

  const start = (url: string) => { setStoreUrl(url); setScreen("running"); window.scrollTo(0, 0); };
  const navigate = (next: Screen) => { setScreen(next); window.scrollTo(0, 0); };
  const [gravacao, setGravacao] = useState<{ data: string; t: number }[]>([]);
  /* Quando quem barrou fomos nós — piso entre tentativas, prazo, blocklist —
     a pessoa fica onde está e lê o motivo, em vez de ver a loja ser acusada. */
  const [nossoProblema, setNossoProblema] = useState<string | null>(null);
  /* Só existe quando o motor está ligado. Sem ele, as telas de exceção são as
     do desenho — que é o que o menu "Ver estados" precisa mostrar. */
  const [apurado, setApurado] = useState<Apurado | null>(null);
  const concluir = (nota: number | null, ressalva: string | null, frames: { data: string; t: number }[]) => {
    /* Com motor, o que o motor disse — INCLUSIVE nota nula, que é o caso de
       cobertura baixa demais para pontuar. Antes a nula era ignorada e o
       estado ficava no 61 do desenho: a tela mostrava a nota de uma loja
       fictícia como se fosse a da loja auditada. Sem motor, o desenho
       continua sendo o desenho. */
    if (temServidor()) setResultado({ nota, ressalva });
    setGravacao(frames);
    navigate("result");
  };

  return (
    <div className="app">
      <Header screen={screen} onNavigate={navigate} />
      {screen === "landing" && <><Landing onStart={start} /><Footer /></>}
      {screen === "running" && <Running url={storeUrl} nossoProblema={nossoProblema} onComplete={concluir} onAbortado={(code, reason, ate) => {
        const culpa = deQuemEAculpa(code);
        setApurado(ate);
        if (culpa === "loja-bloqueou") return navigate("waf");
        if (culpa === "loja-caiu") return navigate("connection");
        /* Nosso: fica na execução, com o motivo do motor dito por extenso. */
        setNossoProblema(reason);
      }} />}
      {screen === "result" && <Result onRestart={() => navigate("landing")} onGravacao={() => navigate("gravacao")} url={storeUrl} nota={resultado.nota} ressalva={resultado.ressalva} />}
      {screen === "waf" && <ExceptionState type="waf" onRetry={() => navigate("running")} onRestart={() => navigate("landing")} {...(apurado ? { real: apurado } : {})} />}
      {screen === "connection" && <ExceptionState type="connection" onRetry={() => navigate("running")} onRestart={() => navigate("landing")} {...(apurado ? { real: apurado } : {})} />}
      {screen === "gravacao" && <Gravacao host={storeUrl || DEMO_STORE} frames={gravacao} onVoltar={() => navigate("result")} />}
    </div>
  );
}

export default App;
